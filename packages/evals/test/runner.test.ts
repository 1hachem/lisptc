import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Verdict } from "../src/report.ts";
import type { EvalSpec, RunResult } from "../src/runner.ts";
import { playwright } from "./fixtures/server.ts";

const TURNS: string[] = [
	'(await (search-mcps "browser"))',
	'(setq p (load-mcp "playwright"))',
	"(await p)",
	'(playwright/browser_navigate :url "https://hyko.ai")',
	"the headline is: Build AI workflows visually.",
];

let turn = 0;
let server: Server;
let runCase: typeof import("../src/runner.ts").runCase;

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
		req.on("data", () => {});
		req.on("end", () => {
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
		process.env.DO_BASE_URL = `http://127.0.0.1:${port}/v1`;
		process.env.DO_API_KEY = "stub";
		process.env.LLM_PROVIDER = "digitalocean";
		({ runCase } = await import("../src/runner.ts"));
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

	test("a check that fails grades the run a failure", async () => {
		turn = 0;
		const result = await runCase(
			{
				min: 4,
				max: 8,
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
	let gate: typeof import("../src/runner.ts").gate;

	beforeAll(async () => {
		({ gate } = await import("../src/runner.ts"));
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

	const spec: EvalSpec = { min: 4, max: 8, checks: "" };

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
