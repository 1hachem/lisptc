import type { TurnOutcome } from "@repo/interpreter/session";
import { AgentRepl } from "@repo/repl/repl";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentDelta, AgentMessage } from "../src/agent.ts";
import type { TranscriptEntry } from "../src/repl.ts";
import type { TurnEvent } from "../src/turn.ts";
import { extension, noting, testRepl } from "./helpers.ts";

interface Seen {
	messages: AgentMessage[];
	system?: string;
}

const seen: Seen[] = [];
let script: AgentDelta[][] = [];
let throws: string | undefined;
let calls = 0;
let onCall: (() => void) | undefined;

const turns = vi.hoisted(
	() => [] as { prompt: string; answer: string; halted: boolean }[],
);
const exceptions = vi.hoisted(() => [] as unknown[]);

const spans = vi.hoisted(
	() => [] as { step: number; source: string; error: boolean }[],
);

vi.mock("../src/telemetry.ts", () => ({
	captureReplEval: (_ctx: unknown, span: (typeof spans)[number]) => {
		spans.push(span);
	},
	captureTurn: (_ctx: unknown, turn: (typeof turns)[number]) => {
		turns.push(turn);
	},
	captureLlmCall: () => {},
	captureException: (error: unknown) => {
		exceptions.push(error);
	},
}));

vi.mock("../src/agent.ts", () => ({
	streamAgent: async function* (
		messages: AgentMessage[],
		config?: { system?: string },
	) {
		seen.push({ messages, system: config?.system });
		onCall?.();
		if (throws) throw new Error(throws);
		const turn = script[Math.min(calls++, script.length - 1)];
		for (const delta of turn) yield delta;
	},
}));

class CountingRepl extends AgentRepl {
	evals = 0;

	override async evalOutput(code: string) {
		this.evals += 1;
		return super.evalOutput(code);
	}
}

describe("the agent turn", () => {
	let runAgentTurn: typeof import("../src/turn.ts").runAgentTurn;

	beforeAll(async () => {
		({ runAgentTurn } = await import("../src/turn.ts"));
	});

	beforeEach(() => {
		seen.length = 0;
		spans.length = 0;
		turns.length = 0;
		exceptions.length = 0;
		script = [];
		throws = undefined;
		calls = 0;
		onCall = undefined;
	});

	async function drain(
		transcript: TranscriptEntry[],
		options: Partial<Parameters<typeof runAgentTurn>[1]> = {},
	): Promise<TurnEvent[]> {
		const events: TurnEvent[] = [];
		for await (const event of runAgentTurn(transcript, {
			repl: testRepl(),
			...options,
		}))
			events.push(event);
		return events;
	}

	const ask: TranscriptEntry[] = [{ role: "user", content: "what is 1 + 2?" }];

	test("a step whose code throws is captured as an error span", async () => {
		script = [[{ text: "(car 5)" }], [{ text: "done." }]];

		await drain(ask);

		expect(spans[0]).toMatchObject({ step: 1, error: true });
		expect(spans[0].source).toBe("(car 5)");
	});

	test("a step that evaluates cleanly is not an error span", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];

		await drain(ask);

		expect(spans[0]).toMatchObject({ step: 1, error: false });
	});

	test("the finishing step is captured as a span", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];

		await drain(ask);

		expect(spans.map((s) => s.source)).toEqual(["(+ 1 2)", "three."]);
	});

	test("a prose reply ends the loop and reports the answer", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];

		const events = await drain(ask);

		expect(events.map((e) => e.type)).toEqual([
			"delta",
			"assistant",
			"result",
			"delta",
			"assistant",
			"halt",
		]);
		expect(events.at(-1)).toMatchObject({ answer: "three.", steps: 2 });
	});

	test("a steer taken between steps reaches the next model call after the tool result", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];
		const pending = [{ id: "s1", content: "use hex" }];

		const events = await drain(ask, { inbox: async () => pending.splice(0) });

		expect(events.map((e) => e.type)).toEqual([
			"delta",
			"assistant",
			"result",
			"steered",
			"delta",
			"assistant",
			"halt",
		]);
		expect(events[3]).toEqual({
			type: "steered",
			id: "s1",
			content: "use hex",
		});
		expect(seen[1].messages.at(-1)).toMatchObject({ content: "use hex" });
		expect(seen[1].messages.at(-2)?.content).toContain('"tool_result"');
	});

	test("the inbox is not read before the first step", async () => {
		script = [[{ text: "three." }]];
		let readBeforeModel = false;
		const inbox = vi.fn(async () => {
			if (seen.length === 0) readBeforeModel = true;
			return [];
		});

		await drain(ask, { inbox });

		expect(readBeforeModel).toBe(false);
	});

	test("the loop stops at maxSteps without an answer", async () => {
		script = [[{ text: "(+ 1 2)" }]];

		const events = await drain(ask, { maxSteps: 2 });

		expect(events.filter((e) => e.type === "result")).toHaveLength(2);
		expect(events.at(-1)).toEqual({ type: "capped", steps: 2 });
	});

	test("an empty reply ends the turn silently", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "" }]];

		const events = await drain(ask);

		expect(events.map((e) => e.type)).toEqual([
			"delta",
			"assistant",
			"result",
			"delta",
			"silent",
		]);
		expect(events.at(-1)).toEqual({ type: "silent", steps: 1 });
	});

	test("an abort mid-stream ends the turn without reporting a failure", async () => {
		const abort = new AbortController();
		onCall = () => abort.abort();
		throws = "aborted";

		const events = await drain(ask, { signal: abort.signal });

		expect(events).toEqual([]);
	});

	test("an abort between steps stops before the next model call", async () => {
		const abort = new AbortController();
		script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];

		const events: TurnEvent[] = [];
		for await (const event of runAgentTurn(ask, {
			repl: testRepl(),
			signal: abort.signal,
		})) {
			events.push(event);
			if (event.type === "result") abort.abort();
		}

		expect(events.map((e) => e.type)).toEqual(["delta", "assistant", "result"]);
		expect(seen).toHaveLength(1);
	});

	test("a failed model call is reported, not thrown", async () => {
		throws = "upstream exploded";

		const events = await drain(ask);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "failed",
			message: "upstream exploded",
		});
	});

	test("withheld prose feedback reaches the model, and the caller's transcript is untouched", async () => {
		const repl = testRepl([noting("(see above)")]);
		await repl.evalOutput("all done");
		repl.takeFinished();
		script = [[{ text: "three." }]];

		await drain(ask, { repl });

		const sent = seen[0].messages;
		expect(sent.at(-1)?.content).toContain("your previous reply ran nothing");
		expect(sent.at(-1)?.content).toContain("(see above)");
		expect(ask).toHaveLength(1);
	});

	test("a consumer that stops consuming stops the loop", async () => {
		const repl = new CountingRepl({ extensions: [] });
		script = [[{ text: "(+ 1 2)" }]];

		for await (const event of runAgentTurn(ask, { repl })) {
			if (event.type === "delta") break;
		}

		expect(repl.evals).toBe(0);
		expect(seen).toHaveLength(1);
	});

	test("the system prompt the model gets is the one the session shaped", async () => {
		script = [[{ text: "three." }]];
		const repl = testRepl([
			extension((hooks) =>
				hooks.system.use(function* (interp, prompt, next) {
					return yield* next(interp, `${prompt}\n\nyou are a pirate`);
				}),
			),
		]);

		await drain(ask, { repl, config: { system: "base" } });

		expect(seen[0].system).toBe("base\n\nyou are a pirate");
	});

	test("a hook can answer in place of the model", async () => {
		const repl = testRepl([
			extension((hooks) =>
				hooks.modelCall.use(async function* () {
					yield { text: "replayed." };
				}),
			),
		]);

		const events = await drain(ask, { repl });

		expect(seen).toHaveLength(0);
		expect(events.at(-1)).toMatchObject({ type: "halt", answer: "replayed." });
	});

	test("a hook can rewrite the code before it runs", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];
		const repl = testRepl([
			extension((hooks) =>
				hooks.response.use((interp, text, next) =>
					next(interp, text.replace("(+ 1 2)", "(+ 2 2)")),
				),
			),
		]);

		const events = await drain(ask, { repl });

		expect(events.find((e) => e.type === "assistant")).toMatchObject({
			code: "(+ 2 2)",
		});
	});

	test("a hook can keep the turn going past an answer", async () => {
		script = [[{ text: "three." }], [{ text: "really three." }]];
		let overruled = false;
		const repl = testRepl([
			extension((hooks) =>
				hooks.stepEnd.use((turn, step, verdict, next) => {
					if (verdict !== "halt" || overruled) return next(turn, step, verdict);
					overruled = true;
					return "continue";
				}),
			),
		]);

		const events = await drain(ask, { repl });

		expect(events.map((e) => e.type)).toEqual([
			"delta",
			"assistant",
			"result",
			"delta",
			"assistant",
			"halt",
		]);
		expect(events.at(-1)).toMatchObject({ answer: "really three.", steps: 2 });
	});

	test("a hook that never lets the turn end still stops at the cap", async () => {
		script = [[{ text: "three." }]];
		const repl = testRepl([
			extension((hooks) => hooks.stepEnd.use(() => "continue")),
		]);

		const events = await drain(ask, { repl, maxSteps: 3 });

		expect(events.at(-1)).toEqual({ type: "capped", steps: 3 });
	});

	test("a steer that lands during the answering step buys one more step", async () => {
		script = [[{ text: "three." }], [{ text: "0x3." }]];
		const pending = [{ id: "s1", content: "use hex" }];

		const events = await drain(ask, { inbox: async () => pending.splice(0) });

		expect(events.map((e) => e.type)).toEqual([
			"delta",
			"assistant",
			"steered",
			"delta",
			"assistant",
			"halt",
		]);
		expect(seen[1].messages.at(-1)).toMatchObject({ content: "use hex" });
		expect(events.at(-1)).toMatchObject({ answer: "0x3.", steps: 2 });
	});

	test("a hook can ask for one more step before the turn settles", async () => {
		script = [[{ text: "three." }], [{ text: "checked: three." }]];
		let asked = false;
		const repl = testRepl([
			extension((hooks) =>
				hooks.beforeSettle.use(function* (ctx, more, next) {
					if (asked) return yield* next(ctx, more);
					asked = true;
					ctx.emit("check your answer");
					return true;
				}),
			),
		]);

		const events = await drain(ask, { repl });

		expect(seen[1].messages.at(-1)?.content).toContain("check your answer");
		expect(events.at(-1)).toMatchObject({
			type: "halt",
			answer: "checked: three.",
		});
	});

	test.each<[string, AgentDelta[][], TurnOutcome]>([
		["halt", [[{ text: "three." }]], "halt"],
		["capped", [[{ text: "(+ 1 2)" }]], "capped"],
		["silent", [[{ text: "" }]], "silent"],
	])("the session sees a %s turn settle", async (_name, turns, expected) => {
		script = turns;
		const outcomes: TurnOutcome[] = [];
		const repl = testRepl([
			extension((hooks) =>
				hooks.settled.use((turn, end, next) => {
					outcomes.push(end.outcome);
					next(turn, end);
				}),
			),
		]);

		await drain(ask, { repl, maxSteps: 2 });

		expect(outcomes).toEqual([expected]);
	});

	test("telemetry still sees a step that a hook does not pass on", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];
		const repl = testRepl([
			extension((hooks) =>
				hooks.stepEnd.use((_turn, step) =>
					step.code === "three." ? "halt" : "continue",
				),
			),
		]);

		await drain(ask, { repl });

		expect(spans.map((s) => s.source)).toEqual(["(+ 1 2)", "three."]);
	});

	test("the turn is traced with its prompt and answer once it settles", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];

		await drain(ask);

		expect(turns).toEqual([
			expect.objectContaining({
				prompt: "what is 1 + 2?",
				answer: "three.",
				halted: true,
			}),
		]);
	});

	test("a failed turn is traced as an exception, an aborted one is not", async () => {
		throws = "upstream exploded";
		await drain(ask);
		expect(exceptions).toHaveLength(1);

		exceptions.length = 0;
		const abort = new AbortController();
		onCall = () => abort.abort();
		await drain(ask, { signal: abort.signal });
		expect(exceptions).toHaveLength(0);
	});

	test("a hook that throws as the turn settles loses neither the trace nor the turn", async () => {
		script = [[{ text: "three." }]];
		const broken = new Error("observer broke");
		const repl = testRepl([
			extension((hooks) =>
				hooks.settled.use(() => {
					throw broken;
				}),
			),
		]);

		const events = await drain(ask, { repl });

		expect(events.at(-1)).toMatchObject({ type: "halt", answer: "three." });
		expect(turns).toHaveLength(1);
		expect(exceptions).toEqual([broken]);
	});
});
