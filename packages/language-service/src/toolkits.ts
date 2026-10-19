import { openAtEnd } from "@repo/shared/lisp-forms";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
	type CompletionItem,
	CompletionItemKind,
	MarkupKind,
	type Position,
} from "vscode-languageserver-types";

export interface Toolkit {
	name: string;
	description?: string;
}

function insideString(document: TextDocument, position: Position): boolean {
	return openAtEnd(
		document.getText({ start: { line: 0, character: 0 }, end: position }),
	).inString;
}

export function loadMcpCompletions(
	headName: string | undefined,
	document: TextDocument,
	position: Position,
	toolkits: readonly Toolkit[],
): CompletionItem[] | undefined {
	if (headName !== "load-mcp" || !insideString(document, position))
		return undefined;
	return toolkits.map((entry) => ({
		label: entry.name,
		kind: CompletionItemKind.Module,
		detail: entry.description?.split("\n")[0],
		documentation:
			entry.description === undefined
				? undefined
				: { kind: MarkupKind.Markdown, value: entry.description },
	}));
}
