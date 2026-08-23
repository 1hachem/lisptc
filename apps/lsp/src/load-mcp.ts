// Completion support for (load-mcp "name")'s string argument: the bare
// predefined toolkit-server name, completed from the bundled toolkit config.
// load-mcp's other calling convention -- the ad-hoc `:key` plist (see
// connConfigFromArgs in packages/interpreter/src/mcp.ts) -- needs no
// load-mcp-specific handling here: its DocArg list is defined once in the
// interpreter (next to connConfigFromArgs) and reaches the LSP the same way
// any MCP tool's args do, through the general keywordCompletions path in
// server.ts.

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

// Completions for (load-mcp "name")'s string argument: the predefined
// servers from the bundled toolkit -- see CLAUDE.md, "the single source of
// ready-to-use servers, callable by bare name". Static config, not runtime
// state, so this is computed once at startup rather than through the session.
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

// True if `position` is inside an unterminated string literal -- an odd
// number of unescaped `"` between the start of the document and the cursor.
// Distinguishes `(load-mcp "pl|")`'s toolkit-name completion from
// `(load-mcp :na|`'s keyword completion; both have "load-mcp" as their head.
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
		if (text[i] === "\\" && inString) {
			i++;
			continue;
		}
		if (text[i] === '"') inString = !inString;
	}
	return inString;
}

// Toolkit-name completions for a call whose head is `headName`, or undefined
// if it isn't `(load-mcp "..."` -- the caller then falls back to the general
// name/keyword path (which handles the `:key` plist form on its own).
export function loadMcpCompletions(
	headName: string | undefined,
	document: TextDocument,
	position: { line: number; character: number },
): CompletionItem[] | undefined {
	if (headName !== "load-mcp" || !insideString(document, position))
		return undefined;
	return toolkitCompletions;
}
