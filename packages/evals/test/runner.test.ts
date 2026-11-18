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
			notes: [],
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
const target: CataloguedChoice = {
	provider: "digitalocean",
	model: "glm-5.3-flash",
};

describe("entries land where they were recorded", () => {
	test("the printed run shows each entry on a line of its own, in the order it arrived", async () => {
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

		const printed = formatRun("case", { ...run, case: "case", sample: 1 })
			.split("\n")
			.filter((line) => line.includes(" │ "));
		expect(printed).toEqual([
			'activity │ {"id":"mcp-1","label":"load-mcp","state":"started"}',
			"memory   │ navigate: browser_navigate, not navigate",
			'agent    │ (load-mcp "playwright")',
			"memory   │ navigate: browser_navigate, not navigate",
			"repl     │ loaded",
			"agent    │ the headline is shown",
		]);
	});
});
