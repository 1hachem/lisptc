import { createServer, type Server } from "node:http";
import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import type { Verdict } from "@repo/evals/report";
import type { RunResult } from "@repo/evals/runner";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { VolatileStore } from "@repo/memory-extension/ports";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { playwright } from "./fixtures/server.ts";
import { mockedMcpExtension, tracedSecretsExtension } from "./mocks.ts";
import type { EvalSpec } from "./runner.ts";

const extensions = () => [
	tracedSecretsExtension(),
	promisesExtension(promisesHost),
	mockedMcpExtension(),
	compactionExtension(compactionHost),
	memoryExtension({ ...memoryHost, store: new VolatileStore() }),
	proseExtension(proseHost),
];

const judgingExtensions = () => [
	tracedSecretsExtension(),
	promisesExtension(promisesHost),
	mockedMcpExtension(),
	compactionExtension(compactionHost),
	memoryExtension({
		...memoryHost,
		store: new VolatileStore(),
		judge: () => new Map([["the user wants the headline", 0.9]]),
	}),
	proseExtension(proseHost),
];

const failingJudgeExtensions = () => [
	tracedSecretsExtension(),
	promisesExtension(promisesHost),
	mockedMcpExtension(),
	compactionExtension(compactionHost),
	memoryExtension({
		...memoryHost,
		store: new VolatileStore(),
		judge: () => Promise.reject(new Error("timed out")),
	}),
	proseExtension(proseHost),
];

function entriesAt(result: RunResult, kind: string): number[] {
	return result.transcript.flatMap((line, at) =>
		line.role === "entry" && line.kind === kind ? [at] : [],
	);
}

function firstAssistant(result: RunResult): number {
	return result.transcript.findIndex((line) => line.role === "assistant");
}

function around(result: RunResult, at: number): [string?, string?] {
	const before = result.transcript
		.slice(0, at)
		.reverse()
		.find((line) => line.role !== "entry");
	const after = result.transcript
		.slice(at + 1)
		.find((line) => line.role !== "entry");
	return [before?.role, after?.role];
}

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

	test("a memory a step fires lands between that step and its result", async () => {
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

		const fired = entriesAt(result, "memory");
		expect(fired).toHaveLength(2);
		for (const at of fired) {
			expect(result.transcript[at]).toMatchObject({
				value: {
					key: "navigate",
					body: "browser_navigate, not navigate",
					on: "call",
				},
			});
			expect(around(result, at)).toEqual(["assistant", "tool"]);
		}
	});

	test("the judge's scores land before the step that read them", async () => {
		turn = 0;
		const result = await runCase(
			{
				min: 4,
				max: 8,
				extensions: judgingExtensions,
				mocks: { servers: { playwright } },
				prelude: `(memory/remember "headline" "the headline is on the page" :on '(asks "the user wants the headline"))`,
				seed: [{ user: "open hyko.ai and tell me the headline" }],
				checks: "(defcheck stops (within 6 (halted)))",
				system: "answer in lisptc.",
			},
			{ provider: "digitalocean", model: "stub" },
		);

		const first = firstAssistant(result);
		const [judged] = entriesAt(result, "judged");
		const [fired] = entriesAt(result, "memory");
		expect(result.transcript[judged]).toMatchObject({
			value: {
				message: "open hyko.ai and tell me the headline",
				scores: { "the user wants the headline": 0.9 },
			},
		});
		expect(result.transcript[fired]).toMatchObject({
			value: { key: "headline", on: "asks" },
		});
		expect(judged).toBeLessThan(fired);
		expect(fired).toBeLessThan(first);
		expect(entriesAt(result, "memory")).toEqual([fired]);
	});

	test("a judge that fails lands in the transcript with its error", async () => {
		turn = 0;
		const result = await runCase(
			{
				min: 4,
				max: 8,
				extensions: failingJudgeExtensions,
				mocks: { servers: { playwright } },
				prelude: `(memory/remember "headline" "the headline is on the page" :on '(asks "the user wants the headline"))`,
				seed: [{ user: "open hyko.ai and tell me the headline" }],
				checks: "(defcheck stops (within 6 (halted)))",
				system: "answer in lisptc.",
			},
			{ provider: "digitalocean", model: "stub" },
		);

		const [judged] = entriesAt(result, "judged");
		expect(result.transcript[judged]).toMatchObject({
			value: { scores: {}, error: "timed out" },
			content: "failed: timed out",
		});
		expect(judged).toBeLessThan(firstAssistant(result));
		expect(entriesAt(result, "memory")).toEqual([]);
	});

	test("a memory the halting step fires lands after the halting step", async () => {
		turn = 0;
		const result = await runCase(
			{
				min: 4,
				max: 8,
				extensions,
				mocks: { servers: { playwright } },
				prelude: `(memory/remember "headline-step" "answer with the headline" :on '(step "headline"))`,
				seed: [{ user: "open hyko.ai" }],
				checks: "(defcheck stops (within 6 (halted)))",
				system: "answer in lisptc.",
			},
			{ provider: "digitalocean", model: "stub" },
		);

		expect(result.halted).toBe(true);
		expect(result.transcript.at(-1)).toMatchObject({
			role: "entry",
			kind: "memory",
			value: {
				key: "headline-step",
				body: "answer with the headline",
				on: "step",
			},
		});
		expect(result.transcript.at(-2)).toMatchObject({
			role: "assistant",
			content: "the headline is: Build AI workflows visually.",
		});
	});

	test("a memory the user's words fire lands before the reply that heard them", async () => {
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

		const [fired] = entriesAt(result, "memory");
		expect(result.transcript[fired]).toMatchObject({
			value: { key: "site", body: "hyko.ai is the product site", on: "user" },
		});
		expect(fired).toBeLessThan(firstAssistant(result));
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
