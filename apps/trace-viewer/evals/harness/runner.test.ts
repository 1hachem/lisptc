import { createServer, type Server } from "node:http";
import { mockedMcpExtension, tracedSecretsExtension } from "@repo/checks/mocks";
import { compactionExtension } from "@repo/compaction-extension";
import type { Verdict } from "@repo/evals/report";
import { memoryExtension, VolatileStore } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { proseExtension } from "@repo/prose-extension";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { playwright } from "./fixtures/server.ts";
import type { EvalSpec, RunResult } from "./runner.ts";

const extensions = () => [
	tracedSecretsExtension(),
	promisesExtension(),
	mockedMcpExtension(),
	compactionExtension(),
	memoryExtension({ ...memoryHost, store: new VolatileStore() }),
	proseExtension(),
];

const TURNS: string[] = [
	'(await (search-mcps "browser"))',
	'(setq p (load-mcp "playwright"))',
	"(await p)",
	'(playwright/browser_navigate :url "https://hyko.ai")',
	"the headline is: Build AI workflows visually.",
];

let turn = 0;
const sent: string[] = [];
let server: Server;
let runCase: typeof import("./runner.ts").runCase;

function chunk(content: string): string {
	return `data: ${JSON.stringify({
		id: "1",
		object: "chat.completion.chunk",
		created: 1,
		model: "stub",
		choices: [{ index: 0, delta: { content } }],
	})}\n\n`;
}

function stub(): Server {
	return createServer((req, res) => {
		let body = "";
		req.on("data", (part) => {
			body += part;
		});
		req.on("end", () => {
			sent.push(body);
			const text = TURNS[Math.min(turn++, TURNS.length - 1)];
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.write(chunk(text));
			res.write(
				`data: ${JSON.stringify({
					id: "1",
					object: "chat.completion.chunk",
					created: 1,
					model: "stub",
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: { prompt_tokens: 100, completion_tokens: 20 },
				})}\n\n`,
			);
			res.write("data: [DONE]\n\n");
			res.end();
		});
	});
}

const CHECKS = `
(defcheck finds-the-server
  (before (called "load-mcp") (called-any "search-mcps" "list-toolkit")))
(defcheck waits-for-the-load
  (before (called-server "playwright") (called "load-mcp")))
(defcheck opens-the-site
  (eventually (called "playwright/browser_navigate" :url (matches "hyko\\\\.ai"))))
(defcheck stays-in-scope
  (never (called-server-other-than "playwright")))
(defcheck stops (within 6 (halted)))
`;

describe("a case runs against a scripted model", () => {
	beforeAll(async () => {
		server = stub();
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		const port =
			typeof address === "object" && address !== null ? address.port : 0;
		vi.stubEnv("DO_BASE_URL", `http://127.0.0.1:${port}/v1`);
		({ runCase } = await import("./runner.ts"));
	});

	afterAll(() => {
		server.closeAllConnections();
		server.close();
	});

	test("grades the run and every check decides", async () => {
		turn = 0;
		const result = await runCase(
			{
				min: 4,
				max: 8,
				extensions,
				mocks: { servers: { playwright } },
				seed: [{ user: "open hyko.ai and tell me the headline" }],
				checks: CHECKS,
				system: "answer in lisptc.",
			},
			{ provider: "digitalocean", model: "stub" },
		);

		expect(result.halted).toBe(true);
		expect(result.steps).toBe(5);
		expect(
			Object.fromEntries(result.checks.map((c) => [c.name, c.verdict])),
		).toEqual({
			"finds-the-server": "true",
			"waits-for-the-load": "true",
			"opens-the-site": "true",
			"stays-in-scope": "true",
			stops: "true",
		});
		expect(result.grade).toBe("degraded");
		expect(result.outputTokens).toBe(100);
		expect(result.inputTokens).toBe(100);
		expect(result.model).toBe("stub");
		expect(result.provider).toBe("digitalocean");
	});

	test("a prelude prepares the repl before the first step", async () => {
		turn = 0;
		const result = await runCase(
			{
				min: 4,
				max: 8,
				extensions,
				mocks: { servers: { playwright } },
				prelude: `(memory/remember "navigate" "browser_navigate, not navigate" :on '(call (load-mcp "playwright")))`,
				seed: [{ user: "open hyko.ai" }],
				checks:
					'(defcheck prelude-ran (eventually (called "memory/remember")))',
				system: "answer in lisptc.",
			},
			{ provider: "digitalocean", model: "stub" },
		);

		expect(result.checks[0]).toMatchObject({
			name: "prelude-ran",
			verdict: "true",
		});
		expect(result.transcript[0]).toEqual({
			role: "user",
			content: "open hyko.ai",
		});
	});

	test("a prelude the reader will not run fails the case loudly", async () => {
		turn = 0;
		await expect(
			runCase(
				{
					min: 4,
					max: 8,
					extensions,
					mocks: { servers: { playwright } },
					prelude: '(memory/remember "k" "a body\nthat wraps")',
					seed: [{ user: "open hyko.ai" }],
					checks: "(defcheck stops (within 6 (halted)))",
					system: "answer in lisptc.",
				},
				{ provider: "digitalocean", model: "stub" },
			),
		).rejects.toThrow(/prelude/);
	});

	test("a memory a seeded turn fires reaches the model", async () => {
		turn = 0;
		sent.length = 0;
		await runCase(
			{
				min: 4,
				max: 8,
				extensions,
				mocks: { servers: { playwright } },
				prelude: `(memory/remember "navigate" "browser_navigate, not navigate" :on '(call (load-mcp "playwright")))`,
				seed: [
					{ user: "open hyko.ai" },
					{ assistant: '(await (load-mcp "playwright"))' },
				],
				checks: "(defcheck stops (within 6 (halted)))",
				system: "answer in lisptc.",
			},
			{ provider: "digitalocean", model: "stub" },
		);

		expect(sent[0]).toContain("browser_navigate, not navigate");
	});

	test("a memory a step fires lands on the line it fired in", async () => {
		turn = 0;
		const result = await runCase(
			{
				min: 4,
				max: 8,
				extensions,
				mocks: { servers: { playwright } },
				prelude: `(memory/remember "navigate" "browser_navigate, not navigate" :on '(call (load-mcp "playwright")))`,
				seed: [
					{ user: "open hyko.ai" },
					{ assistant: '(await (load-mcp "playwright"))' },
				],
				checks: "(defcheck stops (within 6 (halted)))",
				system: "answer in lisptc.",
			},
			{ provider: "digitalocean", model: "stub" },
		);

		const navigate = [
			{ key: "navigate", body: "browser_navigate, not navigate" },
		];
		const fired = result.transcript.filter((line) => line.annotations);
		expect(fired.map((line) => line.role)).toEqual(["tool", "tool"]);
		expect(fired.map((line) => line.annotations?.memories)).toEqual([
			navigate,
			navigate,
		]);
		expect(result.transcript[2]?.annotations?.memories).toEqual(navigate);
	});

	test("a memory the user's words fire lands on the reply that heard them", async () => {
		turn = 0;
		const result = await runCase(
			{
				min: 4,
				max: 8,
				extensions,
				mocks: { servers: { playwright } },
				prelude: `(memory/remember "site" "hyko.ai is the product site" :on '(user "hyko"))`,
				seed: [{ user: "open hyko.ai" }],
				checks: "(defcheck stops (within 6 (halted)))",
				system: "answer in lisptc.",
			},
			{ provider: "digitalocean", model: "stub" },
		);

		expect(result.transcript[1]).toMatchObject({
			role: "assistant",
			annotations: {
				memories: [{ key: "site", body: "hyko.ai is the product site" }],
			},
		});
	});

	test("a check that fails grades the run a failure", async () => {
		turn = 0;
		const result = await runCase(
			{
				min: 4,
				max: 8,
				extensions,
				mocks: { servers: { playwright } },
				seed: [{ user: "open hyko.ai" }],
				checks: '(defcheck never-searches (never (called "search-mcps")))',
				system: "answer in lisptc.",
			},
			{ provider: "digitalocean", model: "stub" },
		);

		expect(result.checks[0]).toMatchObject({
			name: "never-searches",
			verdict: "false",
			step: 1,
		});
		expect(result.grade).toBe("fail");
	});
});

describe("the gate scores a case instead of failing on any miss", () => {
	let gate: typeof import("@repo/evals/runner").gate;

	beforeAll(async () => {
		({ gate } = await import("@repo/evals/runner"));
	});

	function run(verdicts: Verdict[], halted = true): RunResult {
		return {
			provider: "digitalocean",
			model: "stub",
			grade: verdicts.includes("false") || !halted ? "fail" : "pass",
			steps: 4,
			min: 4,
			max: 8,
			halted,
			silent: false,
			answer: halted ? "done" : "",
			inputTokens: 0,
			outputTokens: 0,
			durationMs: 0,
			errors: 0,
			skips: 0,
			checks: verdicts.map((verdict, index) => ({
				name: `check-${index}`,
				verdict,
			})),
			transcript: [],
		};
	}

	const spec: EvalSpec = { min: 4, max: 8, checks: "", extensions };

	test("a minority of failed checks still passes", () => {
		const result = gate(spec, [run(["true", "true", "false"])]);
		expect(result.ok).toBe(true);
		expect(result.line).toContain("scored 3/4");
	});

	test("a majority of failed checks fails", () => {
		const result = gate(spec, [run(["false", "false", "false", "true"])]);
		expect(result.ok).toBe(false);
		expect(result.line).toContain("scored 2/5");
	});

	test("samples are scored together, so one bad run does not sink the case", () => {
		const result = gate(spec, [
			run(["true", "true", "true"]),
			run(["false", "false", "false"], false),
		]);
		expect(result.ok).toBe(true);
		expect(result.line).toContain("never answered");
	});

	test("minScore raises the bar", () => {
		const result = gate({ ...spec, minScore: 1 }, [run(["true", "false"])]);
		expect(result.ok).toBe(false);
	});
});
