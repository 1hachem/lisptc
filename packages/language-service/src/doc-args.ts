import type { DocArg, DocValue } from "@repo/interpreter/docs";
import {
	type CompletionItem,
	CompletionItemKind,
	MarkupKind,
} from "vscode-languageserver-types";

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

export function valueCompletionItems(
	values: readonly DocValue[],
): CompletionItem[] {
	const width = String(values.length).length;
	return values.map((entry, index) => ({
		label: entry.value,
		kind: CompletionItemKind.EnumMember,
		detail: entry.description?.split("\n")[0],
		documentation:
			entry.description === undefined
				? undefined
				: { kind: MarkupKind.Markdown, value: entry.description },
		sortText: String(index).padStart(width, "0"),
	}));
}
