// Language server for lisptc, driven over stdio (e.g. by nvim's built-in LSP
// client). Diagnostics are analysis-only (it never evaluates the buffer), but
// completion and hover query the SHARED session REPL when one is reachable, so
// they reflect live state — definitions you typed into the side REPL (Iron) and
// loaded MCP tools — not just the static prelude. Falls back to a local
// prelude-only interpreter when no session server is running.

import {
	checkSyntax,
	type DocArg,
	Interp,
	prelude,
	run,
} from "@repo/interpreter";
import { mcpExtension } from "@repo/interpreter/mcp.ts";
import {
	type CompletionEntry,
	connectOrSpawn,
	type SessionClient,
	socketPathFor,
} from "@repo/repl/session-server.ts";
import {
	type CompletionItem,
	CompletionItemKind,
	createConnection,
	DiagnosticSeverity,
	MarkupKind,
	ProposedFeatures,
	TextDocumentSyncKind,
	TextDocuments,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { type CallDoc, callDiagnostics } from "./call-diagnostics.ts";
import { argCompletionItems } from "./doc-args.ts";
import { cachedResolver } from "./doc-cache.ts";
import { loadMcpCompletions } from "./load-mcp.ts";
import { enclosingCallHead, markdownFor, symbolAt } from "./symbols.ts";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Local prelude-loaded interpreter: the fallback source of names/docs when the
// shared session is unreachable. The MCP extension contributes load-mcp docs
// without connecting to any server until code explicitly evaluates it.
const interp = new Interp({ extensions: [mcpExtension()] });
run(interp, prelude);
const localDocs = interp.docs();

// The shared session, connected lazily. `connectOrSpawn` boots a server for
// this project if none is running, so the LSP and the terminal REPL converge on
// one interpreter. Best-effort: on failure we serve the local fallback.
let session: SessionClient | undefined;
connectOrSpawn(socketPathFor())
	.then((client) => {
		session = client;
	})
	.catch(() => {
		// No session available; local fallback stands in.
	});

function completionItem(entry: CompletionEntry): CompletionItem {
	const markdown = markdownFor(entry.signature, entry.doc);
	return {
		label: entry.name,
		kind: CompletionItemKind.Function,
		detail: entry.signature,
		documentation:
			markdown === undefined
				? undefined
				: { kind: MarkupKind.Markdown, value: markdown },
		// Explicit (not just the label-as-default): some clients' sortText
		// comparator only kicks in when BOTH competing items set one — e.g.
		// nvim-cmp's compare.sort_text is a no-op unless both sides have it, so
		// without this, comparing an unset-sortText name against a keyword-arg
		// completion (which does set sortText — see keywordCompletions) falls
		// through to a kind-based comparator that ranks Function above Field
		// regardless of intent. Prefixed with "2" so it also sorts after
		// keywordCompletions' "0"/"1" prefixes.
		sortText: `2${entry.name}`,
	};
}

// Local fallback completions from the prelude-only interpreter.
function localCompletions(): CompletionItem[] {
	const names = new Set([...interp.globalNames(), ...localDocs.keys()]);
	return [...names]
		.filter((name) => !name.startsWith("_"))
		.map((name) => {
			const d = localDocs.get(name);
			return completionItem({ name, signature: d?.signature, doc: d?.doc });
		});
}

// Completions are read live per request; a short-lived cache absorbs the burst
// of keystroke-driven requests without spamming the socket. The session query
// only reads globalNames/docs — it never evaluates.
let cache: { at: number; items: CompletionItem[] } | undefined;
const CACHE_MS = 400;

async function currentCompletions(): Promise<CompletionItem[]> {
	if (session === undefined) return localCompletions();
	const now = Date.now();
	if (cache && now - cache.at < CACHE_MS) return cache.items;
	try {
		const items = (await session.completions()).map(completionItem);
		cache = { at: now, items };
		return items;
	} catch {
		return localCompletions();
	}
}

connection.onInitialize(() => ({
	capabilities: {
		textDocumentSync: TextDocumentSyncKind.Incremental,
		completionProvider: {},
		hoverProvider: true,
	},
}));

documents.onDidChangeContent(async ({ document }) => {
	const syntaxErrors = checkSyntax(document.getText()).map((err) => {
		const line = Math.min(err.line, document.lineCount) - 1;
		return {
			severity: DiagnosticSeverity.Error,
			range: {
				start: { line, character: 0 },
				end: { line: line + 1, character: 0 },
			},
			message: err.message,
			source: "lisptc",
		};
	});
	// A syntax error leaves the rest of the token stream unreliable, so skip
	// the call-site checks until it's fixed (matches checkSyntax's own
	// "stop at the first error" behavior).
	const callErrors =
		syntaxErrors.length === 0
			? await callDiagnostics(document.getText(), callDocFor)
			: [];
	// The doc lookups above are async; bail if a newer edit already landed —
	// that change's own onDidChangeContent call will produce fresh diagnostics.
	if (documents.get(document.uri)?.version !== document.version) return;
	connection.sendDiagnostics({
		uri: document.uri,
		diagnostics: [...syntaxErrors, ...callErrors],
	});
});

async function resolveCallDoc(name: string): Promise<CallDoc> {
	if (session !== undefined) {
		try {
			const d = await session.doc(name);
			if (d !== null) return { args: d.args, arity: d.arity };
		} catch {
			// fall through to local
		}
	}
	return { args: localDocs.get(name)?.args, arity: interp.arityOf(name) };
}

// Absorbs the same keystroke burst as `currentCompletions`'s cache above,
// but keyed per name: `callDiagnostics` resolves every distinct call name in
// the buffer on every `onDidChangeContent`, so without this an N-call-name
// buffer round-trips the session socket N times per keystroke.
const callDocFor = cachedResolver(resolveCallDoc, CACHE_MS);

// The structured `Doc.args` for a binding named `name` — undefined for
// anything without keyword args (built-ins, macros, plain user defuns).
async function docArgsFor(name: string): Promise<DocArg[] | undefined> {
	return (await callDocFor(name)).args;
}

// Keyword-arg completions for a call whose head is `headName`. Returns
// undefined when the head isn't a known binding or has no such args, so the
// caller falls back to plain name completion.
async function keywordCompletions(
	headName: string,
): Promise<CompletionItem[] | undefined> {
	const args = await docArgsFor(headName);
	return args?.length ? argCompletionItems(args) : undefined;
}

connection.onCompletion(async ({ textDocument, position }) => {
	const document = documents.get(textDocument.uri);
	const head = document && enclosingCallHead(document, position);
	// (load-mcp "name")'s string argument is one of the bundled toolkit's
	// predefined names, never a general Lisp expression, so it gets its own
	// completions instead of the usual name/keyword path (which the ad-hoc
	// `:key` plist form falls through to below, same as any other binding).
	const loadMcp = document && loadMcpCompletions(head, document, position);
	if (loadMcp) return loadMcp;
	const keywords = head ? await keywordCompletions(head) : undefined;
	const base = await currentCompletions();
	return keywords ? [...keywords, ...base] : base;
});

connection.onHover(async ({ textDocument, position }) => {
	const document = documents.get(textDocument.uri);
	if (document === undefined) return null;
	const sym = symbolAt(document, position.line, position.character);
	if (sym === undefined) return null;

	let sig: string | undefined;
	let doc: string | undefined;
	if (session !== undefined) {
		try {
			const d = await session.doc(sym.name);
			if (d) ({ signature: sig, doc } = d);
		} catch {
			// fall through to local
		}
	}
	if (sig === undefined && doc === undefined) {
		const d = localDocs.get(sym.name);
		if (d) ({ signature: sig, doc } = d);
	}

	const markdown = markdownFor(sig, doc);
	if (markdown === undefined) return null;
	return {
		contents: { kind: MarkupKind.Markdown, value: markdown },
		range: sym.range,
	};
});

documents.listen(connection);
connection.listen();
