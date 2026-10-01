import type {
	SearchDocument,
	SearchEngine,
	SearchHit,
} from "@repo/shared/host";
import MiniSearch from "minisearch";

const MIN_PREFIX = 3;

function tolerance(term: string): number {
	return Math.max(2, Math.floor(term.length / 3));
}

function indexTokens(text: string): string[] {
	const parts = text.split(/[-_]/).filter((part) => part.length > 0);
	return parts.length > 1 ? [text, ...parts] : [text];
}

export const nameSearchEngine: SearchEngine = {
	search(query, documents): readonly SearchHit[] {
		const index = new MiniSearch<SearchDocument>({
			fields: ["name"],
			idField: "id",
			tokenize: indexTokens,
		});
		index.addAll([...documents]);
		return index
			.search(query, {
				tokenize: (text) => [text],
				prefix: query.length >= MIN_PREFIX,
				fuzzy: (term) => tolerance(term),
			})
			.map((hit) => ({ id: String(hit.id), score: hit.score }));
	},
};
