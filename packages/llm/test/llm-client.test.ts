import { createServer, type Server } from "node:http";
import {
	Interp,
	prelude,
	runAsync,
	runSync,
	str,
} from "@repo/interpreter/lisp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface Seen {
	url: string | undefined;
	body: Record<string, unknown>;
}

const seen: Seen[] = [];
let server: Server;
let llmExtension: typeof import("../src/llm.ts").llmExtension;
let hang = false;

function stub(): Server {
	return createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => {
			raw += chunk;
		});
		req.on("end", () => {
			seen.push({ url: req.url, body: JSON.parse(raw) });
			if (hang) return;
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					id: "1",
					object: "chat.completion",
					created: 1,
					model: "stub",
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: '{"words":["one","two"]}',
							},
							finish_reason: "stop",
						},
					],
				}),
			);
		});
	});
}

beforeAll(async () => {
	server = stub();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port =
		typeof address === "object" && address !== null ? address.port : 0;
	process.env.LLAMACPP_BASE_URL = `http://127.0.0.1:${port}/v1`;
	llmExtension = (await import("../src/llm.ts")).llmExtension;
});

afterAll(() => {
	server.closeAllConnections();
	server.close();
});

function clientInterp(): Interp {
	const interp = new Interp({ extensions: [llmExtension()] });
	runSync(interp, prelude);
	return interp;
}

describe("the langchain client against a local OpenAI-compatible server", () => {
	it("sends the prompt, the model and the token budget", async () => {
		const interp = clientInterp();
		const reply = await runAsync(
			interp,
			'(llm/complete "hi" :provider :llamacpp :max-tokens 32)',
		);
		expect(str(reply.value)).toBe('"{\\"words\\":[\\"one\\",\\"two\\"]}"');
		expect(seen.at(-1)?.body).toMatchObject({
			model: "gemma-4-E4B-it",
			stream: false,
			max_tokens: 32,
			messages: [{ role: "user", content: "hi" }],
		});
	});

	it("constrains an extraction with response_format and parses the answer", async () => {
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
		const interp = clientInterp();
		await expect(
			runAsync(interp, '(llm/complete "hi" :provider :nowhere)'),
		).rejects.toThrow(/unknown provider "nowhere"/);
	});

	it("gives up on a request that never answers", async () => {
		hang = true;
		try {
			const interp = clientInterp();
			await expect(
				runAsync(
					interp,
					'(llm/complete "hi" :provider :llamacpp :timeout 100)',
				),
			).rejects.toThrow(/llm timed out/);
		} finally {
			hang = false;
		}
	});
});
