export const STOP_WORDS: ReadonlySet<string> = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"in",
	"is",
	"it",
	"of",
	"on",
	"or",
	"that",
	"the",
	"this",
	"to",
	"with",
]);

export function beyondStopWords(query: string): boolean {
	return query
		.split(/[^\\p{L}\\p{N}]+/u)
		.filter(Boolean)
		.some((term) => !STOP_WORDS.has(term.toLowerCase()));
}

export interface SearchDocument {
	id: string;
	name: string;
	keywords?: readonly string[];
	description?: string;
}

export interface SearchHit {
	id: string;
	score: number;
}

export interface SearchEngine {
	search(
		query: string,
		documents: readonly SearchDocument[],
	): readonly SearchHit[];
}
