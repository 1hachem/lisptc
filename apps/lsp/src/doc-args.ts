import type { DocArg } from "@repo/interpreter";
import {
	type CompletionItem,
	CompletionItemKind,
	MarkupKind,
} from "vscode-languageserver/node.js";

export function argCompletionItems(args: DocArg[]): CompletionItem[] {
	return args.map((arg) => ({
		label: `:${arg.name}`,
		kind: CompletionItemKind.Field,
		detail: `${arg.type}${arg.required ? " (required)" : ""}`,
		documentation:
			arg.description === undefined
				? undefined
				: { kind: MarkupKind.Markdown, value: arg.description },
		sortText: `${arg.required ? 0 : 1}${arg.name}`,
	}));
}
