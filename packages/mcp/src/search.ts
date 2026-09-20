import type { SearchDocument, SearchEngine, SearchHit } from "./ports.ts";

const SUBSTRING_MIN = 3;

export const keywordSearchEngine: SearchEngine = {
	search(query, documents) {
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		const hits: SearchHit[] = [];
		for (const document of documents) {
			const score = scoreDocument(terms, document);
			if (score > 0) hits.push({ id: document.id, score });
		}
		return hits;
	},
};

function scoreDocument(terms: string[], document: SearchDocument): number {
	const name = document.name.toLowerCase();
	const keywords = (document.keywords ?? []).map((keyword) =>
		keyword.toLowerCase(),
	);
	const description = (document.description ?? "").toLowerCase();
	let score = 0;
	for (const term of terms) {
		if (name === term || keywords.includes(term)) score += 3;
		else if (term.length < SUBSTRING_MIN) continue;
		else if (
			name.includes(term) ||
			keywords.some((keyword) => keyword.includes(term))
		)
			score += 2;
		else if (description.includes(term)) score += 1;
	}
	return score;
}
