import {
	Interp,
	prelude,
	runAsync,
	runSync,
	str,
} from "@repo/interpreter/lisp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

interface Seen {
	url: string;
	body: Record<string, unknown>;
}

const seen: Seen[] = [];
let llmExtension: typeof import("../src/llm.ts").llmExtension;

const completion = {
	id: "1",
	object: "chat.completion",
	created: 1,
	model: "stub",
	choices: [
		{
			index: 0,
			message: { role: "assistant", content: '{"words":["one","two"]}' },
			finish_reason: "stop",
		},
	],
};

function stubFetch(
	answer: (signal: AbortSignal | null | undefined) => Promise<Response>,
): void {
	vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: (input as Request).url;
		const raw = typeof init?.body === "string" ? init.body : "";
		seen.push({ url, body: JSON.parse(raw) });
		return answer(init?.signal);
	});
}

function answers(): Promise<Response> {
	return Promise.resolve(
		new Response(JSON.stringify(completion), {
			headers: { "content-type": "application/json" },
		}),
	);
}

function neverAnswers(
	signal: AbortSignal | null | undefined,
): Promise<Response> {
	return new Promise((_, reject) => {
		signal?.addEventListener("abort", () =>
			reject(new DOMException("aborted", "AbortError")),
		);
	});
}

beforeAll(async () => {
	process.env.LLAMACPP_BASE_URL = "http://llamacpp.test/v1";
	llmExtension = (await import("../src/llm.ts")).llmExtension;
	await import("@langchain/openai");
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function clientInterp(): Interp {
	const interp = new Interp({ extensions: [llmExtension()] });
	runSync(interp, prelude);
	return interp;
}

describe("the langchain client against a stubbed fetch", () => {
	it("sends the prompt, the model and the token budget", async () => {
		stubFetch(answers);
		const interp = clientInterp();
		const reply = await runAsync(
			interp,
			'(llm/complete "hi" :provider :llamacpp :max-tokens 32)',
		);
		expect(str(reply.value)).toBe('"{\\"words\\":[\\"one\\",\\"two\\"]}"');
		expect(seen.at(-1)?.url).toBe("http://llamacpp.test/v1/chat/completions");
		expect(seen.at(-1)?.body).toMatchObject({
			model: "gemma-4-E4B-it",
			stream: false,
			max_tokens: 32,
			messages: [{ role: "user", content: "hi" }],
		});
	});

	it("constrains an extraction with response_format and parses the answer", async () => {
		stubFetch(answers);
		const interp = clientInterp();
		const value = await runAsync(
			interp,
			'(llm/extract "one and two" (list (cons "words" (list :list :string))) :provider :llamacpp)',
		);
		expect(str(value.value)).toBe('(("words" "one" "two"))');
		expect(seen.at(-1)?.body.response_format).toEqual({
			type: "json_schema",
			json_schema: {
				name: "extraction",
				schema: {
					type: "object",
					additionalProperties: false,
					required: ["words"],
					properties: { words: { type: "array", items: { type: "string" } } },
				},
			},
		});
	});

	it("reports an unknown provider without calling out", async () => {
		stubFetch(answers);
		const interp = clientInterp();
		const before = seen.length;
		await expect(
			runAsync(interp, '(llm/complete "hi" :provider :nowhere)'),
		).rejects.toThrow(/unknown provider "nowhere"/);
		expect(seen.length).toBe(before);
	});

	it("gives up on a request that never answers", async () => {
		stubFetch(neverAnswers);
		const interp = clientInterp();
		await expect(
			runAsync(interp, '(llm/complete "hi" :provider :llamacpp :timeout 100)'),
		).rejects.toThrow(/llm timed out/);
	});
});
