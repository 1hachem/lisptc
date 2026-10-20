import { formSpans } from "@repo/shared/lisp-forms";
import { looksLikeParenthesizedProse } from "@repo/shared/lisp-prose";

export function quietly(text: string): string {
	let out = text;
	for (const [start, end] of formSpans(text).reverse()) {
		const form = text.slice(start, end);
		if (looksLikeParenthesizedProse(form)) continue;
		out = `${out.slice(0, start)}(quietly ${form})${out.slice(end)}`;
	}
	return out;
}
