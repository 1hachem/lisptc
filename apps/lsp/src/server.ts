import {
	checkSyntax,
	type DocArg,
	Interp,
	prelude,
	runSync,
} from "@repo/interpreter";
import { compactionExtension } from "@repo/interpreter/compaction";
import { mcpExtension } from "@repo/interpreter/mcp";
import {
	type CompletionEntry,
	connectOrSpawn,
	type SessionClient,
	socketPathFor,
} from "@repo/repl/session-server";
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

const interp = new Interp({
	extensions: [mcpExtension(), compactionExtension()],
});
runSync(interp, prelude);
const localDocs = interp.docs();

let session: SessionClient | undefined;
connectOrSpawn(socketPathFor())
	.then((client) => {
		session = client;
	})
	.catch(() => {});

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
		sortText: `2${entry.name}`,
	};
}

function localCompletions(): CompletionItem[] {
	const names = new Set([...interp.globalNames(), ...localDocs.keys()]);
	return [...names]
		.filter((name) => !name.startsWith("_"))
		.map((name) => {
			const d = localDocs.get(name);
			return completionItem({ name, signature: d?.signature, doc: d?.doc });
		});
}

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
	const callErrors =
		syntaxErrors.length === 0
			? await callDiagnostics(document.getText(), callDocFor)
			: [];
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
		} catch {}
	}
	return { args: localDocs.get(name)?.args, arity: interp.arityOf(name) };
}

const callDocFor = cachedResolver(resolveCallDoc, CACHE_MS);

async function docArgsFor(name: string): Promise<DocArg[] | undefined> {
	return (await callDocFor(name)).args;
}

async function keywordCompletions(
	headName: string,
): Promise<CompletionItem[] | undefined> {
	const args = await docArgsFor(headName);
	return args?.length ? argCompletionItems(args) : undefined;
}

connection.onCompletion(async ({ textDocument, position }) => {
	const document = documents.get(textDocument.uri);
	const head = document && enclosingCallHead(document, position);
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
		} catch {}
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
