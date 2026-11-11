import { StepHold } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type {
	InterpExtension,
	ModelDelta,
	TurnOutcome,
} from "@repo/interpreter/session";
import { MemoryImageStore } from "@repo/repl/image-store";
import { AgentRepl } from "@repo/repl/repl";
import type { ChatMessage } from "@repo/shared/messages";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { TranscriptEntry } from "../src/repl.ts";
import type { TurnEvent } from "../src/turn.ts";
import {
	asking,
	concluding,
	extension,
	hearing,
	receiving,
	recording,
	reporting,
	telling,
	testRepl,
} from "./helpers.ts";

interface Seen {
	messages: ChatMessage[];
	system?: string;
}

const seen: Seen[] = [];
let script: ModelDelta[][] = [];
let throws: string | undefined;
let calls = 0;
let onCall: (() => void) | undefined;

const turns = vi.hoisted(
	() => [] as { prompt: string; answer: string; halted: boolean }[],
);
const exceptions = vi.hoisted(() => [] as unknown[]);
const exceptionProperties = vi.hoisted(() => [] as unknown[]);

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
	captureException: (error: unknown, _ctx: unknown, properties: unknown) => {
		exceptions.push(error);
		exceptionProperties.push(properties);
	},
}));

vi.mock("../src/agent.ts", () => ({
	streamAgent: async function* (
		messages: ChatMessage[],
		config?: { system?: string },
	) {
		seen.push({ messages, system: config?.system });
		onCall?.();
		if (throws) throw new Error(throws);
		const turn = script[Math.min(calls++, script.length - 1)];
		for (const delta of turn) yield delta;
	},
}));

function holding(name: string, reason: string): InterpExtension {
	return (interp: Interp): void => {
		interp.defineGlobal(
			newSym(name),
			interp.makeBuiltIn(name, 0, () => {
				recording(interp.channels, "waiting", reason);
				throw new StepHold(reason);
			}),
		);
	};
}

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
		exceptionProperties.length = 0;
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
			if (event.type !== "system") events.push(event);
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

	test("steps-taken counts the steps of this turn, not the replies of earlier ones", async () => {
		script = [
			[{ text: "(echo steps-taken)" }],
			[{ text: "(echo steps-taken)" }],
			[{ text: "done." }],
		];

		const events = await drain([
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "(+ 1 1)" },
			{ role: "assistant", content: "hello." },
			...ask,
		]);

		expect(
			events.flatMap((e) => (e.type === "result" ? [e.display] : [])),
		).toEqual(["0\n", "1\n"]);
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

	test("a held step reports what it recorded, then its result, before the turn halts", async () => {
		script = [[{ text: "(wait-for-human)" }], [{ text: "never asked." }]];

		const events = await drain(ask, {
			repl: testRepl([holding("wait-for-human", "approve the write")]),
		});

		expect(events.map((e) => e.type)).toEqual([
			"delta",
			"assistant",
			"entry",
			"result",
			"halt",
		]);
		expect(events[2]).toEqual({
			type: "entry",
			entry: expect.objectContaining({
				kind: "waiting",
				value: "approve the write",
			}),
		});
		expect(events[3]).toMatchObject({
			type: "result",
			step: 1,
			failed: false,
			held: true,
		});
		expect(calls).toBe(1);
	});

	test("every step saves its image as a layer of the step that ran it", async () => {
		script = [
			[{ text: "(setq a 1)" }],
			[{ text: "(setq b 2)" }],
			[{ text: "done." }],
		];
		const images = new MemoryImageStore();

		const events = await drain(ask, { repl: testRepl([], images) });
		await new Promise((resolve) => setTimeout(resolve, 0));

		const steps = events.flatMap((e) =>
			e.type === "assistant" ? [e.stepId] : [],
		);
		expect(images.origins()).toEqual(steps);
	});

	test("a step that ends the turn records what it shows the person, and leaves no result for the model", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "never asked." }]];

		const events = await drain(ask, { repl: testRepl([asking("Pick")]) });

		expect(events.map((e) => e.type)).toEqual([
			"delta",
			"assistant",
			"entry",
			"halt",
		]);
		expect(events[2]).toEqual({
			type: "entry",
			entry: expect.objectContaining({ kind: "asked", value: "Pick" }),
		});
		expect(calls).toBe(1);
	});

	test("what the turn records as it settles is journaled before the turn ends", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];

		const events = await drain(ask, {
			repl: testRepl([concluding("wrapped")]),
		});

		expect(events.slice(-2)).toEqual([
			{
				type: "entry",
				entry: expect.objectContaining({ kind: "closed", value: "wrapped" }),
			},
			expect.objectContaining({ type: "halt" }),
		]);
	});

	test("an answered step halts without a result event", async () => {
		script = [[{ text: "three." }]];

		const events = await drain(ask);

		expect(events.map((e) => e.type)).toEqual(["delta", "assistant", "halt"]);
		expect(calls).toBe(1);
	});

	test("a step that halts still reports what its evaluation recorded", async () => {
		script = [[{ text: "three." }]];

		const events = await drain(ask, { repl: testRepl([reporting("noted")]) });

		expect(events.map((e) => e.type)).toEqual([
			"delta",
			"assistant",
			"entry",
			"halt",
		]);
		expect(events[2]).toEqual({
			type: "entry",
			entry: expect.objectContaining({ kind: "reported", value: "noted" }),
		});
	});

	test("what a step records before the model answers comes before the model's answer", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];

		const events = await drain(ask, { repl: testRepl([hearing("hi")]) });

		expect(
			events
				.filter((e) => e.type === "entry" || e.type === "assistant")
				.map((e) => e.type),
		).toEqual(["entry", "assistant", "entry", "assistant"]);
		expect(events.find((e) => e.type === "entry")).toEqual({
			type: "entry",
			entry: expect.objectContaining({ kind: "heard", value: "hi" }),
		});
	});

	test("a note an extension appends reaches the model once, as a system message after the prompt", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];

		const events = await drain(ask, {
			repl: testRepl([telling("you are a pirate")]),
		});

		expect(events.filter((e) => e.type === "noted")).toEqual([
			{
				type: "noted",
				note: { role: "system", content: "you are a pirate", source: "test" },
			},
		]);
		expect(seen[0].messages).toEqual([
			{ role: "user", content: "what is 1 + 2?" },
			{ role: "developer", content: "you are a pirate" },
		]);
		expect(
			seen[1].messages.filter((m) => m.content === "you are a pirate"),
		).toHaveLength(1);
		expect(seen[1].messages[0]).toEqual({
			role: "user",
			content: "what is 1 + 2?",
		});
	});

	test("what the user's message carried beside its text is told as a note by whoever reads it", async () => {
		script = [[{ text: "three." }]];

		await drain(ask, {
			repl: testRepl([receiving()]),
			received: { said: "in hex" },
		});

		expect(seen[0].messages).toEqual([
			{ role: "user", content: "what is 1 + 2?" },
			{ role: "developer", content: "the user also said: in hex" },
		]);
	});

	test("what a message carried notes nothing when no extension reads it", async () => {
		script = [[{ text: "three." }]];

		const events = await drain(ask, { received: { said: "in hex" } });

		expect(events.some((e) => e.type === "noted")).toBe(false);
		expect(seen[0].messages).toEqual([
			{ role: "user", content: "what is 1 + 2?" },
		]);
	});

	test("a note from an earlier turn reaches the model in place, and is not something the user said", async () => {
		script = [[{ text: "three." }]];
		const history: TranscriptEntry[] = [
			{ role: "user", content: "hello" },
			{ role: "system", content: "you are a pirate", source: "test" },
			{ role: "assistant", content: "ahoy." },
			{ role: "user", content: "what is 1 + 2?" },
		];
		const repl = testRepl();

		await drain(history, { repl });

		expect(seen[0].messages[1]).toEqual({
			role: "developer",
			content: "you are a pirate",
		});
		expect(
			repl.interp.conversation
				.said()
				.filter((s) => s.role === "user")
				.map((s) => s.content),
		).toEqual(["hello", "what is 1 + 2?"]);
	});

	test("a steer taken between steps reaches the next model call after the tool result", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];
		const pending = [
			{ kind: "user" as const, id: "s1", text: "use hex", forms: true },
		];

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

	test("a steer's lisp runs when the steer is taken, and the model reads its result as a system event after the steer", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "done." }]];
		const pending = [
			{ kind: "user" as const, id: "s1", text: "(+ 40 2)", forms: true },
		];

		const events = await drain(ask, { inbox: async () => pending.splice(0) });

		const steered = events.findIndex((e) => e.type === "steered");
		expect(events[steered + 1]).toMatchObject({
			type: "evaluated",
			message: { type: "tool", additional_kwargs: { results: ["42"] } },
		});
		expect(seen[1].messages.slice(-2).map((m) => m.content)).toEqual([
			"(+ 40 2)",
			'<system-event source="lisp-repl">the user ran the code in their message above:\n\n(no output)</system-event>',
		]);
	});

	test("a steer's lisp does not run when the turn runs no forms, and the model reads the steer as plain text", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "done." }]];
		const pending = [
			{ kind: "user" as const, id: "s1", text: "(+ 40 2)", forms: true },
		];

		const events = await drain(ask, {
			inbox: async () => pending.splice(0),
			runsForms: false,
		});

		expect(events.map((e) => e.type)).not.toContain("evaluated");
		expect(seen[1].messages.at(-1)).toMatchObject({ content: "(+ 40 2)" });
		expect(seen[1].messages.at(-2)?.content).toContain('"tool_result"');
	});

	test("an event never runs as lisp, and the model reads it as a system event", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "done." }]];
		const pending = [
			{ kind: "event" as const, id: "s1", source: "agent:r", text: "(+ 40 2)" },
		];

		const events = await drain(ask, { inbox: async () => pending.splice(0) });

		expect(events.map((e) => e.type)).not.toContain("evaluated");
		expect(seen[1].messages.at(-1)).toMatchObject({
			content: '<system-event source="agent:r">(+ 40 2)</system-event>',
		});
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

		expect(events.map((e) => e.type)).toEqual([
			"system",
			"delta",
			"assistant",
			"result",
		]);
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

	test("a note left between turns reaches the model, and the caller's transcript is untouched", async () => {
		const repl = testRepl();
		repl.interp.conversation.append("stub", "a note left between turns");
		script = [[{ text: "three." }]];

		await drain(ask, { repl });

		const sent = seen[0].messages;
		expect(sent.at(-1)?.content).toContain("a note left between turns");
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

	test("the turn counts the system prompt in tokens, fewer than its characters", async () => {
		script = [[{ text: "three." }]];
		const counted: number[] = [];
		for (const system of ["be terse", "be terse ".repeat(50)])
			for await (const event of runAgentTurn(ask, {
				repl: testRepl(),
				config: { system },
			}))
				if (event.type === "system") counted.push(event.tokens);

		const [short, long] = counted;
		expect(short).toBeGreaterThan(0);
		expect(short).toBeLessThan("be terse".length);
		expect(long).toBeGreaterThan(short ?? 0);
	});

	test("a steer that lands during the answering step buys one more step", async () => {
		script = [[{ text: "three." }], [{ text: "0x3." }]];
		const pending = [
			{ kind: "user" as const, id: "s1", text: "use hex", forms: true },
		];

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
					ctx.interp.conversation.append("test", "check your answer");
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

	test.each<[string, ModelDelta[][], TurnOutcome]>([
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

	test("telemetry sees every step the turn ran", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];

		await drain(ask);

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

	test("a hook that throws on what the message carried is traced with the keys it carried, never their values", async () => {
		script = [[{ text: "three." }]];
		const broken = new Error("reader broke");
		const repl = testRepl([
			extension((hooks) =>
				hooks.received.use(() => {
					throw broken;
				}),
			),
		]);

		await drain(ask, { repl, received: { said: "a secret" } });

		expect(exceptions[0]).toBe(broken);
		expect(exceptionProperties[0]).toEqual({ received: ["said"] });
		expect(JSON.stringify(exceptionProperties)).not.toContain("a secret");
	});
});
