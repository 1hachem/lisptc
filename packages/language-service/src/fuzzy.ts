import Fuse, { type FuseResultMatch } from "fuse.js";
import type { CompletionItem } from "vscode-languageserver-types";

export interface RankedCompletion {
	item: CompletionItem;
	matched: number[];
}

const bySortText = (a: CompletionItem, b: CompletionItem) =>
	(a.sortText ?? a.label).localeCompare(b.sortText ?? b.label) ||
	a.label.length - b.label.length;

function matchedIndices(matches: readonly FuseResultMatch[] = []): number[] {
	return matches.flatMap(({ indices }) =>
		indices.flatMap(([from, to]) =>
			Array.from({ length: to - from + 1 }, (_, i) => from + i),
		),
	);
}

export function rankCompletions(
	items: readonly CompletionItem[],
	typed: string,
): RankedCompletion[] {
	if (typed === "")
		return [...items].sort(bySortText).map((item) => ({ item, matched: [] }));
	return new Fuse(items, {
		keys: ["label"],
		includeScore: true,
		includeMatches: true,
		shouldSort: false,
	})
		.search(typed)
		.sort(
			(a, b) => (a.score ?? 1) - (b.score ?? 1) || bySortText(a.item, b.item),
		)
		.map(({ item, matches }) => ({ item, matched: matchedIndices(matches) }));
}
