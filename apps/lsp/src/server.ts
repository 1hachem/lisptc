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
	type Diagnostic,
	DiagnosticSeverity,
	MarkupKind,
	ProposedFeatures,
	TextDocuments,
	TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
	checkSyntax,
	type DocArg,
	Interp,
	prelude,
	run,
} from "@repo/interpreter";
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
	// the required-arg check until it's fixed (matches checkSyntax's own
	// "stop at the first error" behavior).
	const argErrors =
		syntaxErrors.length === 0 ? await requiredArgDiagnostics(document) : [];
	// The doc lookups above are async; bail if a newer edit already landed —
	// that change's own onDidChangeContent call will produce fresh diagnostics.
	if (documents.get(document.uri)?.version !== document.version) return;
	connection.sendDiagnostics({
		uri: document.uri,
		diagnostics: [...syntaxErrors, ...argErrors],
	});
});

// A symbol is any run of characters the reader doesn't treat as delimiters.
const symbolChar = /[^()'`~"; \t]/;

// Walk backward from `position` tracking paren depth to find the call this
// position is nested in, then read the symbol right after its opening paren,
// e.g. `(playwright/browser_navigate :u|)` -> "playwright/browser_navigate".
// Ignores string/comment contents, same simplification as `symbolAt` below.
function enclosingCallHead(
	document: TextDocument,
	position: { line: number; character: number },
): string | undefined {
	const text = document.getText({
		start: { line: 0, character: 0 },
		end: position,
	});
	let depth = 0;
	for (let i = text.length - 1; i >= 0; i--) {
		const c = text[i];
		if (c === ")") {
			depth++;
		} else if (c === "(") {
			if (depth === 0) {
				let j = i + 1;
				while (j < text.length && /\s/.test(text[j])) j++;
				let k = j;
				while (k < text.length && symbolChar.test(text[k])) k++;
				return k > j ? text.slice(j, k) : undefined;
			}
			depth--;
		}
	}
	return undefined;
}

// The structured `Doc.args` for a binding named `name`, populated for
// keyword-call bindings (currently just MCP tools; see toolArgs in
// packages/interpreter/src/mcp.ts) — undefined for anything else (built-ins,
// macros, plain user defuns).
async function docArgsFor(name: string): Promise<DocArg[] | undefined> {
	if (session !== undefined) {
		try {
			const args = (await session.doc(name))?.args;
			if (args !== undefined) return args;
		} catch {
			// fall through to local
		}
	}
	return localDocs.get(name)?.args;
}

// Keyword-arg completions for a call whose head is `headName`, e.g. `:url` for
// `playwright/browser_navigate`. Returns undefined when the head isn't a known
// binding or has no such args, so the caller falls back to plain name
// completion.
async function keywordCompletions(
	headName: string,
): Promise<CompletionItem[] | undefined> {
	const args = await docArgsFor(headName);
	if (!args?.length) return undefined;
	return args.map((arg) => ({
		label: `:${arg.name}`,
		kind: CompletionItemKind.Field,
		detail: `${arg.type}${arg.required ? " (required)" : ""}`,
		documentation:
			arg.description === undefined
				? undefined
				: { kind: MarkupKind.Markdown, value: arg.description },
		// Force these above the ~100+ plain-name completions regardless of
		// client sort behavior: required args first, then alphabetical within
		// each group. Sorts before any name completion (those default to their
		// label, and "0"/"1" precede every identifier character) even though a
		// client that ignores sortText and just keeps server order would still
		// see them first from the array order below.
		sortText: `${arg.required ? 0 : 1}${arg.name}`,
	}));
}

// --- Required keyword-argument diagnostics ----------------------------------
//
// Flags calls like `(playwright/browser_navigate)` that omit a required
// keyword arg, mirroring the runtime check in packages/interpreter/src/mcp.ts
// (`validate`) but statically, without evaluating the buffer.

interface Atom {
	kind: "atom";
	text: string;
	line: number;
	char: number;
}
interface ListForm {
	kind: "list";
	items: Node[];
	openLine: number;
	openChar: number;
	closeLine: number;
	closeChar: number;
}
type Node = Atom | ListForm;

// Tokenize with (line, char) positions, using the same token pattern as the
// interpreter's own Reader so forms line up with what it would actually read.
function tokenizeWithPositions(text: string): Atom[] {
	const tokenPat = /\s+|;.*$|("(\\.?|.)*?"|,@?|[^()'`~"; \t]+|.)/g;
	const tokens: Atom[] = [];
	const lines = text.split("\n");
	for (let line = 0; line < lines.length; line++) {
		const s = lines[line];
		for (;;) {
			const m = tokenPat.exec(s);
			if (m === null) break;
			if (m[1] !== undefined)
				tokens.push({ kind: "atom", text: m[1], line, char: m.index });
		}
	}
	return tokens;
}

// Parse tokens into a tree of lists/atoms with positions. Best-effort: quote
// syntax (', `, , ,@) and stray unmatched parens aren't specially handled —
// this only needs to find call forms `(head ...)` and their direct `:keyword`
// children, which is enough for a static, non-evaluating check.
function parseForms(tokens: Atom[]): Node[] {
	let i = 0;
	function parseOne(): Node | undefined {
		const t = tokens[i];
		if (t === undefined || t.text === ")") {
			if (t !== undefined) i++;
			return undefined;
		}
		if (t.text !== "(") {
			i++;
			return t;
		}
		i++;
		const items: Node[] = [];
		while (tokens[i] !== undefined && tokens[i].text !== ")") {
			const item = parseOne();
			if (item !== undefined) items.push(item);
		}
		const close = tokens[i];
		if (close !== undefined) i++;
		return {
			kind: "list",
			items,
			openLine: t.line,
			openChar: t.char,
			closeLine: close?.line ?? t.line,
			closeChar: close?.char ?? t.char,
		};
	}
	const forms: Node[] = [];
	for (let f = parseOne(); f !== undefined; f = parseOne()) forms.push(f);
	return forms;
}

// Every call form `(head ...)` found anywhere in the program (including
// nested), with the head symbol's position and the `:keyword` names passed
// directly to it — not through a nested form, since those belong to a
// different call.
function collectCalls(
	nodes: Node[],
	out: { name: string; head: Atom; keywords: Set<string> }[] = [],
) {
	for (const n of nodes) {
		if (n.kind !== "list") continue;
		const [head, ...rest] = n.items;
		if (head?.kind === "atom" && !head.text.startsWith(":")) {
			const keywords = new Set(
				rest
					.filter(
						(item): item is Atom =>
							item.kind === "atom" && item.text.startsWith(":"),
					)
					.map((item) => item.text.slice(1)),
			);
			out.push({ name: head.text, head, keywords });
		}
		collectCalls(n.items, out);
	}
	return out;
}

async function requiredArgDiagnostics(
	document: TextDocument,
): Promise<Diagnostic[]> {
	const calls = collectCalls(parseForms(tokenizeWithPositions(document.getText())));
	const names = [...new Set(calls.map((c) => c.name))];
	const argsByName = new Map(
		await Promise.all(
			names.map(async (name) => [name, await docArgsFor(name)] as const),
		),
	);
	const diagnostics: Diagnostic[] = [];
	for (const call of calls) {
		for (const arg of argsByName.get(call.name) ?? []) {
			if (!arg.required || call.keywords.has(arg.name)) continue;
			diagnostics.push({
				severity: DiagnosticSeverity.Error,
				range: {
					start: { line: call.head.line, character: call.head.char },
					end: {
						line: call.head.line,
						character: call.head.char + call.name.length,
					},
				},
				message: `${call.name}: missing required argument ":${arg.name}"`,
				source: "lisptc",
			});
		}
	}
	return diagnostics;
}

connection.onCompletion(async ({ textDocument, position }) => {
	const document = documents.get(textDocument.uri);
	const head = document && enclosingCallHead(document, position);
	const keywords = head ? await keywordCompletions(head) : undefined;
	const base = await currentCompletions();
	return keywords ? [...keywords, ...base] : base;
});

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
