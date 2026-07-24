// Language server for lisptc, driven over stdio (e.g. by nvim's built-in LSP
// client). Analysis only — it never evaluates the buffer.
import {
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

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// One prelude-loaded interpreter: the source of global names and their docs
// (which the interpreter registers alongside each definition). docs() also
// covers special forms and t/nil, which are not globals.
const interp = new Interp();
run(interp, prelude);
const docs = interp.docs();

function markdownFor(name: string): string | undefined {
	const d = docs.get(name);
	if (d === undefined) return undefined;
	return `\`\`\`lisp\n${d.signature}\n\`\`\`\n${d.doc}`;
}

const names = new Set([...interp.globalNames(), ...docs.keys()]);

const completions = [...names]
	.filter((name) => !name.startsWith("_"))
	.map((name) => {
		const markdown = markdownFor(name);
		return {
			label: name,
			kind: CompletionItemKind.Function,
			detail: docs.get(name)?.signature,
			documentation:
				markdown === undefined
					? undefined
					: { kind: MarkupKind.Markdown, value: markdown },
		};
	});

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

connection.onCompletion(() => completions);

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

connection.onHover(({ textDocument, position }) => {
	const document = documents.get(textDocument.uri);
	if (document === undefined) return null;
	const sym = symbolAt(document, position.line, position.character);
	if (sym === undefined) return null;
	const markdown = markdownFor(sym.name);
	if (markdown === undefined) return null;
	return {
		contents: { kind: MarkupKind.Markdown, value: markdown },
		range: sym.range,
	};
});

documents.listen(connection);
connection.listen();
