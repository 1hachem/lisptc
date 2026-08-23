// Shared "keyword-arg -> CompletionItem" rendering: used both for real
// bindings' documented args (see keywordCompletions in server.ts) and for
// load-mcp's synthetic arg list (see load-mcp.ts).

import type { DocArg } from "@repo/interpreter";
import {
	type CompletionItem,
	CompletionItemKind,
	MarkupKind,
} from "vscode-languageserver/node.js";

// Render `DocArg`s as `:key` completion items, e.g. `:url` for
// `playwright/browser_navigate`.
export function argCompletionItems(args: DocArg[]): CompletionItem[] {
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
