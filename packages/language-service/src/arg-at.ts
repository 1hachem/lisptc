import type { DocArg } from "@repo/interpreter/docs";
import { openAtEnd } from "@repo/shared/lisp-forms";
import { isKeywordToken } from "@repo/shared/lisp-tokens";
import { type Node, parseForms, tokenizeWithPositions } from "./tokenize.ts";

function openStringStart(text: string): number {
	for (let at = text.lastIndexOf('"'); at >= 0; ) {
		let slashes = 0;
		while (text[at - slashes - 1] === "\\") slashes++;
		if (slashes % 2 === 0) return at;
		at = text.lastIndexOf('"', at - 1);
	}
	return -1;
}

function keywordOf(item: Node): string | undefined {
	return item.kind === "atom" && isKeywordToken(item.text)
		? item.text.slice(1)
		: undefined;
}

function slotAfter(items: readonly Node[]): string | number {
	let positional = 0;
	let keyword: string | undefined;
	for (const item of items) {
		const named = keywordOf(item);
		if (named !== undefined) keyword = named;
		else if (keyword !== undefined) keyword = undefined;
		else positional++;
	}
	return keyword ?? positional;
}

export function stringArgAt(
	before: string,
	args: readonly DocArg[],
): DocArg | undefined {
	const open = openAtEnd(before);
	const paren = open.parens.at(-1);
	if (!open.inString || paren === undefined) return undefined;
	const call = before.slice(paren, openStringStart(before));
	const [form] = parseForms(tokenizeWithPositions(call));
	if (form?.kind !== "list") return undefined;
	const slot = slotAfter(form.items.slice(1));
	if (typeof slot !== "number") return args.find((arg) => arg.name === slot);
	const last = args.at(-1);
	return args[slot] ?? (last?.repeats ? last : undefined);
}
