import { describe, expect, it } from "vitest";
import {
	DEFAULT_EMBEDDING_MODEL,
	openRouterEmbedding,
} from "../src/embedding.ts";

interface Sent {
	url: string;
	headers: Headers;
	body: Record<string, unknown>;
}

function stubFetch(reply: unknown, status = 200) {
	const sent: Sent[] = [];
	const fetch = async (
		url: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		sent.push({
			url: String(url),
			headers: new Headers(init?.headers),
			body: JSON.parse(String(init?.body)),
		});
		return new Response(JSON.stringify(reply), {
			status,
			headers: { "content-type": "application/json" },
		});
	};
	return { sent, fetch };
}

const CONFIG = {
	apiKey: "or-test",
	apiKeyEnv: "OPENROUTER_API_KEY",
	baseUrl: "https://openrouter.ai/api/v1",
};

describe("openRouterEmbedding", () => {
	it("sends every input to OpenRouter's embeddings endpoint in one request with the key", async () => {
		const { sent, fetch } = stubFetch({
			model: DEFAULT_EMBEDDING_MODEL,
			data: [
				{ index: 0, embedding: [1, 0] },
				{ index: 1, embedding: [0, 1] },
			],
		});
		await openRouterEmbedding({ ...CONFIG, fetch }).embed({
			inputs: ["cat", "dog"],
		});
		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe("https://openrouter.ai/api/v1/embeddings");
		expect(sent[0]?.headers.get("authorization")).toBe("Bearer or-test");
		expect(sent[0]?.body).toEqual({
			model: DEFAULT_EMBEDDING_MODEL,
			input: ["cat", "dog"],
		});
	});

	it("asks for the model a request names over its own", async () => {
		const { sent, fetch } = stubFetch({
			data: [{ index: 0, embedding: [1] }],
		});
		await openRouterEmbedding({ ...CONFIG, fetch }).embed({
			inputs: ["cat"],
			model: "openai/text-embedding-3-large",
		});
		expect(sent[0]?.body.model).toBe("openai/text-embedding-3-large");
	});

	it("returns the vectors in input order, whatever order they come back in", async () => {
		const { fetch } = stubFetch({
			model: "qwen/qwen3-embedding-8b",
			data: [
				{ index: 1, embedding: [0, 1] },
				{ index: 0, embedding: [1, 0] },
			],
		});
		const res = await openRouterEmbedding({ ...CONFIG, fetch }).embed({
			inputs: ["cat", "dog"],
		});
		expect(res).toEqual({
			model: "qwen/qwen3-embedding-8b",
			vectors: [
				[1, 0],
				[0, 1],
			],
		});
	});

	it("fails with the vendor's message when the request is refused", async () => {
		const { fetch } = stubFetch({ error: { message: "no credits" } }, 402);
		await expect(
			openRouterEmbedding({ ...CONFIG, fetch }).embed({ inputs: ["cat"] }),
		).rejects.toThrow("402");
	});

	it("fails when a vector is missing from the answer", async () => {
		const { fetch } = stubFetch({ data: [{ index: 0, embedding: [1] }] });
		await expect(
			openRouterEmbedding({ ...CONFIG, fetch }).embed({
				inputs: ["cat", "dog"],
			}),
		).rejects.toThrow("left out input 1");
	});

	it("names the missing variable instead of calling OpenRouter without a key", async () => {
		const { sent, fetch } = stubFetch({ data: [] });
		await expect(
			openRouterEmbedding({ ...CONFIG, apiKey: undefined, fetch }).embed({
				inputs: ["cat"],
			}),
		).rejects.toThrow("OPENROUTER_API_KEY is not set");
		expect(sent).toHaveLength(0);
	});
});
