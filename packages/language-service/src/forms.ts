import { type FormJudge, formsOnly } from "@repo/shared/lisp-forms";
import { looksLikeParenthesizedProse } from "@repo/shared/lisp-prose";

const parenthesizedProse: FormJudge = {
	unclosed: () => undefined,
	unreadable: (text, start, end) =>
		looksLikeParenthesizedProse(text.slice(start, end)) ? "prose" : undefined,
};

export function lispIn(message: string): string {
	return formsOnly(message, parenthesizedProse);
}
