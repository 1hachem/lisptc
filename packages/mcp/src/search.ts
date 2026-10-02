import { beyondStopWords, STOP_WORDS } from "@repo/shared/search";
import MiniSearch from "minisearch";
import type { SearchDocument, SearchEngine, SearchHit } from "./ports.ts";

const FIELDS = ["name", "keywords", "description"];
const BOOST = { name: 3, keywords: 2, description: 1 };
const FUZZY = 0.2;
const MIN_PREFIX = 3;

function fieldText(document: SearchDocument, field: string): string {
	if (field === "keywords") return (document.keywords ?? []).join(" ");
	const value = document[field as keyof SearchDocument];
	return typeof value === "string" ? value : "";
}

export const miniSearchEngine: SearchEngine = {
	search(query, documents): readonly SearchHit[] {
		const thinned = beyondStopWords(query);
		const index = new MiniSearch<SearchDocument>({
			fields: FIELDS,
			idField: "id",
			extractField: fieldText,
		});
		index.addAll([...documents]);
		return index
			.search(query, {
				prefix: (term) => term.length >= MIN_PREFIX,
				fuzzy: FUZZY,
				boost: BOOST,
				processTerm: (term) => {
					const lower = term.toLowerCase();
					return thinned && STOP_WORDS.has(lower) ? null : lower;
				},
			})
			.map((hit) => ({ id: String(hit.id), score: hit.score }));
	},
};
