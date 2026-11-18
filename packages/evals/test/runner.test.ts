import type { CataloguedChoice } from "@repo/shared/providers";
import { describe, expect, test } from "vitest";
import type { EvalTurnEvent } from "../src/runner.ts";
import {
	type AgentDriver,
	type EvalRuntime,
	type EvalSpec,
	formatRun,
	runCase,
} from "../src/runner.ts";

const FIRED = {
	kind: "memory",
	value: {
		key: "navigate",
		body: "browser_navigate, not navigate",
		on: "call",
	},
};
const RECOGNIZED = {
	kind: "recognized",
	value: {
		message: "open hyko.ai",
		scores: { "the user wants the headline": 0.9 },
	},
};
const FAILED = {
	kind: "recognized",
	value: { message: "open hyko.ai", scores: {}, error: "timed out" },
};

function runtimeFor(
	events: EvalTurnEvent[],
	systemPrompt = "",
): EvalRuntime<EvalSpec, object> {
	const agent: AgentDriver<object> = {
		eval: async () => ({
			output: "",
			error: false,
			entries: [],
			notes: [],
		}),
		resultContent: (output) => output,
		systemPrompt: () => systemPrompt,
		turn: async function* () {
			for (const event of events) yield event;
		},
	};
	return {
		agent,
		open: () => ({
			repl: {},
			trace: {
				beginStep: () => {},
				reply: () => {},
				halt: () => {},
				mark: () => 0,
				refusedSince: () => false,
				errors: () => 0,
				skips: () => 0,
			},
			checks: { evaluate: () => {}, results: () => [] },
		}),
		validateChecks: () => {},
		mocks: () => [],
	};
}

const spec: EvalSpec = { min: 1, max: 5, checks: "" };
const target: CataloguedChoice = {
	provider: "digitalocean",
	model: "glm-5.3-flash",
};

describe("entries land where they were recorded", () => {
	test("the printed run shows each entry on a line of its own, in the order it arrived", async () => {
		const run = await runCase(
			runtimeFor([
				{ type: "entry", entry: RECOGNIZED },
				{ type: "entry", entry: FIRED },
				{ type: "assistant", code: '(load-mcp "playwright")', meta: {} },
				{ type: "entry", entry: FIRED },
				{ type: "result", output: "loaded" },
				{ type: "assistant", code: "the headline is shown", meta: {} },
				{ type: "halt", answer: "the headline is shown" },
			]),
			spec,
			target,
		);

		const printed = formatRun("case", { ...run, case: "case", sample: 1 })
			.split("\n")
			.filter((line) => line.includes(" │ "));
		expect(printed).toEqual([
			"recognized │ the user wants the headline → 0.90",
			"memory     │ navigate: browser_navigate, not navigate",
			'agent      │ (load-mcp "playwright")',
			"memory     │ navigate: browser_navigate, not navigate",
			"repl       │ loaded",
			"agent      │ the headline is shown",
		]);
	});

	test("a failed recognition shows its error in the printed run", async () => {
		const run = await runCase(
			runtimeFor([
				{ type: "entry", entry: FAILED },
				{ type: "assistant", code: "done", meta: {} },
				{ type: "halt", answer: "done" },
			]),
			spec,
			target,
		);

		expect(formatRun("case", { ...run, case: "case", sample: 1 })).toContain(
			"recognized │ failed: timed out",
		);
	});
});

describe("a run keeps the system prompt it ran under", () => {
	test("the agent's own prompt when the case sets none", async () => {
		const run = await runCase(
			runtimeFor([{ type: "halt", answer: "done" }], "you are a lisp machine"),
			spec,
			target,
		);
		expect(run.system).toBe("you are a lisp machine");
	});

	test("the case's prompt when it sets one", async () => {
		const run = await runCase(
			runtimeFor([{ type: "halt", answer: "done" }], "you are a lisp machine"),
			{ ...spec, system: "answer in lisptc." },
			target,
		);
		expect(run.system).toBe("answer in lisptc.");
	});
});
