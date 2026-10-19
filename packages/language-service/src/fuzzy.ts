import type { CompletionItem } from "vscode-languageserver-types";

export interface RankedCompletion {
	item: CompletionItem;
	matched: number[];
}

const WORD_BOUNDARY = /[-:/*_.?!>]/;
const PREFIX_BONUS = 10;
const BOUNDARY_BONUS = 3;
const ADJACENT_BONUS = 2;

function startsWord(label: string, at: number): boolean {
	return at === 0 || WORD_BOUNDARY.test(label[at - 1] ?? "");
}

interface Match {
	score: number;
	matched: number[];
}

function stepScore(label: string, at: number, previous?: number): number {
	const gap = previous === undefined ? 0 : at - previous - 1;
	return (
		(startsWord(label, at) ? BOUNDARY_BONUS : 0) +
		(previous !== undefined && gap === 0 ? ADJACENT_BONUS : 0) -
		gap
	);
}

function matchFrom(
	typed: string,
	label: string,
	start: number,
): Match | undefined {
	const folded = label.toLowerCase();
	const matched: number[] = [];
	let score = 0;
	for (const char of typed) {
		const previous = matched.at(-1);
		const at =
			previous === undefined ? start : folded.indexOf(char, previous + 1);
		if (at < 0) return undefined;
		score += stepScore(label, at, previous);
		matched.push(at);
	}
	return { score, matched };
}

function fuzzyMatch(typed: string, label: string): Match | undefined {
	const query = typed.toLowerCase();
	const folded = label.toLowerCase();
	let best: Match | undefined;
	for (let at = folded.indexOf(query[0] ?? ""); at >= 0; ) {
		const match = matchFrom(query, label, at);
		if (match && (best === undefined || match.score > best.score)) best = match;
		at = folded.indexOf(query[0] ?? "", at + 1);
	}
	if (best && folded.startsWith(query)) best.score += PREFIX_BONUS;
	return best;
}

export function rankCompletions(
	items: readonly CompletionItem[],
	typed: string,
): RankedCompletion[] {
	return items
		.filter((item) => item.label !== typed)
		.flatMap((item) => {
			const match = fuzzyMatch(typed, item.label);
			return match ? [{ item, ...match }] : [];
		})
		.sort(
			(a, b) =>
				b.score - a.score ||
				(a.item.sortText ?? a.item.label).localeCompare(
					b.item.sortText ?? b.item.label,
				) ||
				a.item.label.length - b.item.label.length,
		)
		.map(({ item, matched }) => ({ item, matched }));
}
