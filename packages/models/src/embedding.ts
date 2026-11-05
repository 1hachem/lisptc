import type { EmbeddingModel, EmbedResult } from "@repo/shared/embedding";
import type { ProviderSpec } from "@repo/shared/providers";

export const DEFAULT_EMBEDDING_MODEL = "qwen/qwen3-embedding-8b";

export interface OpenRouterEmbeddingConfig
	extends Pick<ProviderSpec, "apiKey" | "apiKeyEnv" | "baseUrl"> {
	model?: string;
	fetch?: typeof fetch;
}

function isVector(x: unknown): x is number[] {
	return Array.isArray(x) && x.every((n) => typeof n === "number");
}

function resultOf(body: unknown, count: number, asked: string): EmbedResult {
	const reply = (body ?? {}) as {
		data?: unknown;
		model?: unknown;
		error?: { message?: unknown };
	};
	if (reply.error !== undefined)
		throw new Error(
			`OpenRouter embeddings failed: ${String(reply.error.message ?? "unknown error")}`,
		);
	if (!Array.isArray(reply.data))
		throw new Error("OpenRouter embeddings answered without data");
	const vectors: number[][] = new Array(count);
	reply.data.forEach((entry: { embedding?: unknown; index?: unknown }, i) => {
		const at = typeof entry.index === "number" ? entry.index : i;
		if (!isVector(entry.embedding) || at < 0 || at >= count)
			throw new Error(`OpenRouter embeddings answered a bad entry at ${i}`);
		vectors[at] = entry.embedding;
	});
	for (let i = 0; i < count; i++)
		if (vectors[i] === undefined)
			throw new Error(`OpenRouter embeddings left out input ${i}`);
	return {
		vectors,
		model: typeof reply.model === "string" ? reply.model : asked,
	};
}

export function openRouterEmbedding(
	config: OpenRouterEmbeddingConfig,
): EmbeddingModel {
	const model = config.model ?? DEFAULT_EMBEDDING_MODEL;
	const send = config.fetch ?? fetch;
	return {
		provider: "openrouter",
		model,
		async embed(req, signal) {
			const asked = req.model ?? model;
			if (config.apiKey === undefined)
				throw new Error(
					`${config.apiKeyEnv} is not set. Add it to the environment to reach ${asked} through OpenRouter.`,
				);
			if (req.inputs.length === 0) return { vectors: [], model: asked };
			const res = await send(
				`${config.baseUrl.replace(/\/+$/, "")}/embeddings`,
				{
					method: "POST",
					headers: {
						authorization: `Bearer ${config.apiKey}`,
						"content-type": "application/json",
					},
					body: JSON.stringify({ model: asked, input: req.inputs }),
					...(signal === undefined ? {} : { signal }),
				},
			);
			if (!res.ok)
				throw new Error(
					`OpenRouter embeddings answered ${res.status}: ${await res.text()}`,
				);
			return resultOf(await res.json(), req.inputs.length, asked);
		},
	};
}
