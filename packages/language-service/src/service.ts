import type { DocArg } from "@repo/interpreter/docs";
import { openAtEnd } from "@repo/shared/lisp-forms";
import { isKeywordToken } from "@repo/shared/lisp-tokens";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
	type CompletionItem,
	CompletionItemKind,
	type Diagnostic,
	DiagnosticSeverity,
	type Hover,
	MarkupKind,
	type Position,
	type SignatureHelp,
} from "vscode-languageserver-types";
import {
	type Diagnostic as CallProblem,
	callDiagnostics,
} from "./call-diagnostics.ts";
import { enclosingCallHead, markdownFor, symbolAt } from "./cursor.ts";
import { argCompletionItems } from "./doc-args.ts";
import type { SymbolEntry, SymbolTable } from "./symbol-table.ts";
import { syntaxDiagnostics } from "./syntax.ts";
import { parseForms, tokenizeWithPositions } from "./tokenize.ts";
import { loadMcpCompletions, type Toolkit } from "./toolkits.ts";

export interface CallAt {
	entry: SymbolEntry;
	supplied: ReadonlySet<string>;
	active?: string;
}

export interface LanguageService {
	completions(document: TextDocument, position: Position): CompletionItem[];
	hover(document: TextDocument, position: Position): Hover | null;
	diagnostics(document: TextDocument): Diagnostic[];
	callAt(document: TextDocument, position: Position): CallAt | undefined;
	signatureHelp(
		document: TextDocument,
		position: Position,
	): SignatureHelp | null;
}

export interface LanguageServiceOptions {
	toolkits?: readonly Toolkit[];
}

function symbolItem(entry: SymbolEntry): CompletionItem {
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

function textBefore(document: TextDocument, position: Position): string {
	return document.getText({ start: { line: 0, character: 0 }, end: position });
}

export function insideForm(
	document: TextDocument,
	position: Position,
): boolean {
	return openAtEnd(textBefore(document, position)).parens.length > 0;
}

function keywordsOf(slice: string): string[] {
	const [form] = parseForms(tokenizeWithPositions(slice));
	if (form?.kind !== "list") return [];
	return form.items.flatMap((item) =>
		item.kind === "atom" && isKeywordToken(item.text)
			? [item.text.slice(1)]
			: [],
	);
}

function parameterDoc(arg: DocArg): string {
	const kind = `${arg.type}${arg.required ? " (required)" : ""}`;
	return arg.description === undefined ? kind : `${kind}: ${arg.description}`;
}

function editorDiagnostic(problem: CallProblem): Diagnostic {
	return {
		...problem,
		severity:
			problem.severity === "error"
				? DiagnosticSeverity.Error
				: DiagnosticSeverity.Warning,
		source: "lisptc",
	};
}

export function languageService(
	table: SymbolTable,
	options: LanguageServiceOptions = {},
): LanguageService {
	let symbolItems: CompletionItem[] | undefined;

	const callAt = (
		document: TextDocument,
		position: Position,
	): CallAt | undefined => {
		const before = textBefore(document, position);
		const open = openAtEnd(before).parens.at(-1);
		if (open === undefined) return undefined;
		const head = enclosingCallHead(document, position);
		const entry = head === undefined ? undefined : table.get(head);
		if (entry === undefined) return undefined;
		const keywords = keywordsOf(before.slice(open));
		const names = new Set(entry.args?.map((arg) => arg.name));
		return {
			entry,
			supplied: new Set(keywords),
			active: [...keywords].reverse().find((keyword) => names.has(keyword)),
		};
	};

	return {
		completions(document, position) {
			const head = enclosingCallHead(document, position);
			const toolkits = loadMcpCompletions(
				head,
				document,
				position,
				options.toolkits ?? [],
			);
			if (toolkits) return toolkits;
			const args = head === undefined ? undefined : table.get(head)?.args;
			symbolItems ??= [...table.values()].map(symbolItem);
			return args?.length
				? [...argCompletionItems(args), ...symbolItems]
				: symbolItems;
		},

		hover(document, position) {
			const symbol = symbolAt(document, position.line, position.character);
			const entry = symbol === undefined ? undefined : table.get(symbol.name);
			const markdown = markdownFor(entry?.signature, entry?.doc);
			if (symbol === undefined || markdown === undefined) return null;
			return {
				contents: { kind: MarkupKind.Markdown, value: markdown },
				range: symbol.range,
			};
		},

		diagnostics(document) {
			const syntax = syntaxDiagnostics(document);
			return syntax.length > 0
				? syntax
				: callDiagnostics(document.getText(), table).map(editorDiagnostic);
		},

		callAt,

		signatureHelp(document, position) {
			const call = callAt(document, position);
			if (call?.entry.signature === undefined) return null;
			const args = call.entry.args ?? [];
			const active = args.findIndex((arg) => arg.name === call.active);
			return {
				signatures: [
					{
						label: call.entry.signature,
						documentation:
							call.entry.doc === undefined
								? undefined
								: { kind: MarkupKind.Markdown, value: call.entry.doc },
						parameters: args.map((arg) => ({
							label: `:${arg.name}`,
							documentation: {
								kind: MarkupKind.Markdown,
								value: parameterDoc(arg),
							},
						})),
					},
				],
				activeSignature: 0,
				activeParameter: active < 0 ? undefined : active,
			};
		},
	};
}
