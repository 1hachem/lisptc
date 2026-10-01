import {
	beyondStopWords,
	type SearchDocument,
	type SearchEngine,
	type SearchHit,
	STOP_WORDS,
} from "@repo/shared/host";
import MiniSearch from "minisearch";

const FIELDS = ["name", "description"];
const BOOST = { name: 2, description: 1 };
const FUZZY = 0.2;
const MIN_PREFIX = 3;

function fieldText(document: SearchDocument, field: string): string {
	if (field === "keywords") return (document.keywords ?? []).join(" ");
	const value = document[field as keyof SearchDocument];
	return typeof value === "string" ? value : "";
}

export const memorySearchEngine: SearchEngine = {
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
				combineWith: "AND",
				processTerm: (term) => {
					const lower = term.toLowerCase();
					return thinned && STOP_WORDS.has(lower) ? null : lower;
				},
			})
			.map((hit) => ({ id: String(hit.id), score: hit.score }));
	},
};
