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
const STARTED = {
	kind: "activity",
	value: { id: "mcp-1", label: "load-mcp", state: "started" },
};

function runtimeFor(events: EvalTurnEvent[]): EvalRuntime<EvalSpec, object> {
	const agent: AgentDriver<object> = {
		eval: async () => ({
			output: "",
			error: false,
			entries: [],
			emitted: "",
		}),
		resultContent: (output) => output,
		systemPrompt: () => "",
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
const target = { provider: "digitalocean", model: "stub" } as const;

describe("entries land where they were recorded", () => {
	test("each entry is a line of its own, in the order it arrived", async () => {
		const run = await runCase(
			runtimeFor([
				{ type: "entry", entry: STARTED },
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

		expect(run.transcript.map((line) => line.role)).toEqual([
			"entry",
			"entry",
			"assistant",
			"entry",
			"tool",
			"assistant",
		]);
		expect(run.transcript[0]).toMatchObject({
			kind: "activity",
			value: STARTED.value,
			content: JSON.stringify(STARTED.value),
		});
		expect(run.transcript[1]).toMatchObject({
			kind: "memory",
			value: FIRED.value,
			content: "navigate: browser_navigate, not navigate",
		});
		expect(run.transcript[3]).toMatchObject({ kind: "memory" });
	});

	test("a recorded memory shows under its kind in the printed run", async () => {
		const run = await runCase(
			runtimeFor([
				{ type: "entry", entry: FIRED },
				{ type: "assistant", code: "done", meta: {} },
				{ type: "halt", answer: "done" },
			]),
			spec,
			target,
		);

		expect(run.transcript[0]).toMatchObject({
			role: "entry",
			kind: "memory",
			content: "navigate: browser_navigate, not navigate",
		});
		expect(formatRun("case", { ...run, case: "case", sample: 1 })).toContain(
			"memory │ navigate: browser_navigate, not navigate",
		);
	});
});
