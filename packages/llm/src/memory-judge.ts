import { bodyText, type Judge } from "@repo/interpreter/memory";
import type { Generate, LlmRequest } from "./llm.ts";

const JUDGE_SYSTEM =
	"You match a query against a list of stored memories and return the keys of the ones that would help answer it. Judge by meaning, not by shared words. Rank the keys you return most relevant first, and return an empty list when none apply. Never return a key that is not in the list.";

const RANKING_SCHEMA = {
	type: "object",
	properties: {
		relevant: {
			type: "array",
			items: { type: "string" },
			description:
				"Memory keys that answer the query, most relevant first; empty when none apply.",
		},
	},
	required: ["relevant"],
	additionalProperties: false,
};

export interface JudgeOptions {
	provider?: string;
	model?: string;
	maxTokens?: number;
}

export function judgeWith(
	generate: Generate,
	options: JudgeOptions = {},
): Judge {
	return async (query, candidates) => {
		if (candidates.length === 0) return [];
		const known = new Set(candidates.map((memory) => memory.key));
		const catalog = candidates
			.map((memory) => `- ${memory.key}: ${bodyText(memory.body)}`)
			.join("\n");
		const req: LlmRequest = {
			messages: [
				{ role: "system", content: JUDGE_SYSTEM },
				{ role: "user", content: `Query:\n${query}\n\nMemories:\n${catalog}` },
			],
			schema: { name: "memory_ranking", schema: RANKING_SCHEMA },
			...(options.provider ? { provider: options.provider } : {}),
			...(options.model ? { model: options.model } : {}),
			...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
		};
		const res = await generate(req);
		return keysFrom(res.value).filter((key) => known.has(key));
	};
}

function keysFrom(value: unknown): string[] {
	if (value === null || typeof value !== "object") return [];
	const relevant = (value as { relevant?: unknown }).relevant;
	if (!Array.isArray(relevant)) return [];
	return relevant.filter((key): key is string => typeof key === "string");
}
