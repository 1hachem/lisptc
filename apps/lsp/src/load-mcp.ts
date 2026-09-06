import toolkitConfig from "@repo/interpreter/mcp.toolkit.json" with {
	type: "json",
};
import {
	type CompletionItem,
	CompletionItemKind,
	MarkupKind,
} from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";

interface ToolkitEntry {
	name: string;
	description?: string;
}

const toolkitCompletions: CompletionItem[] = (
	toolkitConfig as ToolkitEntry[]
).map((entry) => ({
	label: entry.name,
	kind: CompletionItemKind.Module,
	detail: entry.description?.split("\n")[0],
	documentation:
		entry.description === undefined
			? undefined
			: { kind: MarkupKind.Markdown, value: entry.description },
}));

function insideString(
	document: TextDocument,
	position: { line: number; character: number },
): boolean {
	const text = document.getText({
		start: { line: 0, character: 0 },
		end: position,
	});
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === "\n") {
			inString = false;
			continue;
		}
		if (inString) {
			if (c === "\\") {
				i++;
				continue;
			}
			if (c === '"') inString = false;
			continue;
		}
		if (c === '"') inString = true;
	}
	return inString;
}

export function loadMcpCompletions(
	headName: string | undefined,
	document: TextDocument,
	position: { line: number; character: number },
): CompletionItem[] | undefined {
	if (headName !== "load-mcp" || !insideString(document, position))
		return undefined;
	return toolkitCompletions;
}
