import type {
	PromptSource,
	SearchDocument,
	SearchEngine,
} from "@repo/shared/host";

export interface DiagnosticsHost {
	prompt: PromptSource;
	search: SearchEngine;
}

function qualifier(name: string): string {
	const at = name.lastIndexOf("/");
	return at < 0 ? "" : name.slice(0, at);
}

function base(name: string): string {
	const at = name.lastIndexOf("/");
	return at < 0 ? name : name.slice(at + 1);
}

export function nearest(
	search: SearchEngine,
	name: string,
	candidates: Iterable<string>,
): string | undefined {
	const wanted = base(name);
	const where = qualifier(name);
	const documents: SearchDocument[] = [];
	for (const candidate of candidates) {
		if (candidate === name) continue;
		if (where !== "" && qualifier(candidate) !== where) continue;
		documents.push({ id: candidate, name: base(candidate) });
	}
	if (documents.length === 0) return undefined;
	const gapOf = new Map(
		documents.map((document) => [
			document.id,
			Math.abs(document.name.length - wanted.length),
		]),
	);
	let best: string | undefined;
	let bestScore = Number.NEGATIVE_INFINITY;
	let bestGap = Number.POSITIVE_INFINITY;
	for (const hit of search.search(wanted, documents)) {
		const gap = gapOf.get(hit.id) ?? Number.POSITIVE_INFINITY;
		if (hit.score < bestScore) continue;
		if (hit.score === bestScore && gap >= bestGap) continue;
		best = hit.id;
		bestScore = hit.score;
		bestGap = gap;
	}
	return best;
}
