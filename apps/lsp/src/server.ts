// Language server for lisptc, driven over stdio (e.g. by nvim's built-in LSP
// client). Diagnostics are analysis-only (it never evaluates the buffer), but
// completion and hover query the SHARED session REPL when one is reachable, so
// they reflect live state — definitions you typed into the side REPL (Iron) and
// loaded MCP tools — not just the static prelude. Falls back to a local
// prelude-only interpreter when no session server is running.
import {
	type CompletionItem,
	CompletionItemKind,
	createConnection,
	DiagnosticSeverity,
	MarkupKind,
	ProposedFeatures,
	TextDocuments,
	TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { checkSyntax, Interp, prelude, run } from "@repo/interpreter";
import {
	type CompletionEntry,
	connectOrSpawn,
	type SessionClient,
	socketPathFor,
} from "@repo/repl/session-server.ts";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Local prelude-loaded interpreter: the fallback source of names/docs when the
// shared session is unreachable. docs() also covers special forms and t/nil.
const interp = new Interp();
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

function markdownFor(sig?: string, doc?: string): string | undefined {
	if (sig === undefined && (doc === undefined || doc === "")) return undefined;
	const body = doc ?? "";
	return sig === undefined ? body : `\`\`\`lisp\n${sig}\n\`\`\`\n${body}`;
}

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

documents.onDidChangeContent(({ document }) => {
	const diagnostics = checkSyntax(document.getText()).map((err) => {
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
	connection.sendDiagnostics({ uri: document.uri, diagnostics });
});

connection.onCompletion(() => currentCompletions());

// A symbol is any run of characters the reader doesn't treat as delimiters.
const symbolChar = /[^()'`~"; \t]/;

function symbolAt(document: TextDocument, line: number, character: number) {
	const text = document.getText({
		start: { line, character: 0 },
		end: { line: line + 1, character: 0 },
	});
	let start = character;
	let end = character;
	while (start > 0 && symbolChar.test(text[start - 1])) start--;
	while (end < text.length && symbolChar.test(text[end])) end++;
	if (start === end) return undefined;
	return {
		name: text.slice(start, end),
		range: {
			start: { line, character: start },
			end: { line, character: end },
		},
	};
}

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
