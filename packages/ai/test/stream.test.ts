import { providerSpecs } from "@repo/env/providers";
import type { ModelDelta } from "@repo/interpreter/session";
import { DEFAULT_PROVIDER } from "@repo/shared/providers";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Envelope } from "../src/mailbox.ts";
import { replResultContent } from "../src/repl.ts";
import type { ChatInput } from "../src/stream.ts";
import {
	asking,
	type ChatStreamOptions,
	concluding,
	extension,
	hearing,
	printing,
	receiving,
	reporting,
	riding,
	streamChat,
	testRepl,
} from "./helpers.ts";

const emitting = (text: string) =>
	extension((hooks) =>
		hooks.evalStep.use((ctx, next) => {
			ctx.emit(text);
			return next(ctx);
		}),
	);

const TURNS: ModelDelta[][] = [
	[{ text: "(+ 1 2)" }, { usage: { input: 10, output: 4 } }],
	[{ text: "three." }, { usage: { input: 20, output: 6, cachedInput: 10 } }],
];

let turn = 0;
let down = false;
const sent: { role: string; content: string }[][] = [];

vi.mock("../src/agent.ts", () => ({
	streamAgent: async function* (messages: { role: string; content: string }[]) {
		sent.push(messages);
		if (down) throw new Error("the provider is down");
		for (const delta of TURNS[Math.min(turn++, TURNS.length - 1)]) yield delta;
	},
}));

interface WireMessage {
	type: string;
	content: string;
	additional_kwargs?: {
		reasoning_content?: string;
		ui?: unknown;
		display?: string;
		riding?: string;
		quiet?: boolean;
		asked?: string[];
		closed?: string[];
		meta?: {
			at?: string;
			durationMs?: number;
			provider?: string;
			model?: string;
			inputTokens?: number;
			outputTokens?: number;
			cachedInputTokens?: number;
			steps?: number;
			reported?: string[];
		};
	};
}

function records(text: string): { event: string; data: unknown }[] {
	return text
		.split("\n\n")
		.filter((record) => record.startsWith("event: "))
		.map((record) => ({
			event: record.slice(7, record.indexOf("\n")),
			data: JSON.parse(record.slice(record.indexOf("data: ") + 6)),
		}));
}

async function finalMessages(response: Response): Promise<WireMessage[]> {
	const text = await response.text();
	const values = text
		.split("\n\n")
		.filter((record) => record.startsWith("event: values"))
		.map(
			(record) =>
				JSON.parse(record.slice(record.indexOf("data: ") + 6)) as {
					messages: WireMessage[];
				},
		);
	return values[values.length - 1].messages;
}

describe("chat stream", () => {
	function stream(
		input: ChatInput,
		options: Partial<ChatStreamOptions> = {},
	): Response {
		return streamChat(input, { repl: testRepl(), ...options });
	}

	async function recorded(
		input: ChatInput,
		options: Partial<ChatStreamOptions> = {},
	): Promise<WireMessage[]> {
		const made: WireMessage[] = [];
		let revised: ReadonlyMap<number, WireMessage> = new Map();
		await stream(input, {
			...options,
			onStep: (produced) => {
				made.push(...produced);
			},
			onTurn: (rest, touched) => {
				made.push(...rest);
				revised = touched;
			},
		}).text();
		const all = [...((input.messages ?? []) as WireMessage[]), ...made];
		for (const [at, message] of revised) all[at] = message;
		return all;
	}

	beforeEach(() => {
		turn = 0;
		down = false;
		sent.length = 0;
	});

	test("a step's value it never echoed reaches no snapshot the person is sent", async () => {
		const body = await stream({
			messages: [{ type: "human", content: "what is 1 + 2?" }],
		}).text();

		const steps = records(body)
			.filter((r) => r.event === "values")
			.flatMap((r) => (r.data as { messages: WireMessage[] }).messages)
			.filter((m) => m.type === "tool");
		expect(steps.length).toBeGreaterThan(0);
		for (const step of steps) {
			expect(step.content).toBe("");
			expect(step.additional_kwargs?.display).toBeUndefined();
		}
	});

	test("what a step printed reaches the record and the model, and no snapshot the person is sent", async () => {
		const ask = { messages: [{ type: "human", content: "what is 1 + 2?" }] };
		const options = { repl: testRepl([printing("PRINTED-LINE\n")]) };
		const body = await stream(ask, options).text();

		expect(body).not.toContain("PRINTED-LINE");
		expect(sent[1].some((m) => m.content.includes("PRINTED-LINE"))).toBe(true);

		turn = 0;
		const persisted = await recorded(ask, options);
		expect(persisted[2].content).toContain("PRINTED-LINE");
		expect(persisted[2].additional_kwargs?.display).toBe("PRINTED-LINE\n");
	});

	test("a step that ends the turn reaches the person and the record, and never the model", async () => {
		const ask = { messages: [{ type: "human", content: "what is 1 + 2?" }] };
		const persisted = await recorded(ask, {
			repl: testRepl([asking("Pick")]),
		});

		expect(persisted.map((m) => m.type)).toEqual(["human", "ai", "tool"]);
		expect(persisted[2].additional_kwargs).toMatchObject({
			asked: ["Pick"],
			quiet: true,
		});

		sent.length = 0;
		const messages = await finalMessages(
			stream({
				messages: [...persisted, { type: "human", content: "A" }],
			}),
		);
		expect(messages[2].additional_kwargs?.asked).toEqual(["Pick"]);
		expect(sent[0].some((m) => m.content.includes("tool_result"))).toBe(false);
	});

	test("what the turn leaves as it settles lands on its last step, flushed or not", async () => {
		const ask = { messages: [{ type: "human", content: "what is 1 + 2?" }] };
		const options = { repl: testRepl([concluding("wrapped")]) };
		const persisted = await recorded(ask, options);

		expect(persisted.map((m) => m.type)).toEqual(["human", "ai", "tool", "ai"]);
		expect(persisted[2].additional_kwargs?.closed).toEqual(["wrapped"]);

		turn = 0;
		const messages = await finalMessages(stream(ask, options));
		expect(messages[2].additional_kwargs?.closed).toEqual(["wrapped"]);
	});

	test("what the turn leaves as it settles is kept out of the model's sight when no step ran", async () => {
		turn = 1;
		const persisted = await recorded(
			{ messages: [{ type: "human", content: "what is 1 + 2?" }] },
			{ repl: testRepl([concluding("wrapped")]) },
		);

		expect(persisted.map((m) => m.type)).toEqual(["human", "ai", "tool"]);
		expect(persisted[2]).toMatchObject({
			content: "",
			additional_kwargs: { closed: ["wrapped"], quiet: true },
		});
	});

	test("reports why a turn failed, and nothing when it did not", async () => {
		const failures: (string | undefined)[] = [];
		const onTurn: ChatStreamOptions["onTurn"] = (_made, _revised, failure) => {
			failures.push(failure);
		};
		const ask = { messages: [{ type: "human", content: "what is 1 + 2?" }] };

		await stream(ask, { onTurn }).text();
		down = true;
		await stream(ask, { onTurn }).text();

		expect(failures).toEqual([undefined, expect.stringContaining("down")]);
	});

	test("a steer posted mid-turn is recorded in order", async () => {
		const waiting: Envelope[] = [
			{ kind: "user", id: "s1", text: "use hex", forms: true },
		];
		const recorded: { type: string; content: string; id: string }[] = [];
		const messages = await finalMessages(
			stream(
				{ messages: [{ type: "human", content: "what is 1 + 2?" }] },
				{
					inbox: async () => waiting.splice(0),
					onTurn: (produced) => {
						recorded.push(...produced);
					},
				},
			),
		);

		expect(messages.map((m) => m.type)).toEqual([
			"human",
			"ai",
			"tool",
			"human",
			"ai",
		]);
		expect(recorded.map((m) => m.type)).toEqual(["ai", "tool", "human", "ai"]);
		expect(recorded[2]).toMatchObject({ id: "s1", content: "use hex" });
	});

	test("an event taken mid-turn is recorded as a system message", async () => {
		const waiting: Envelope[] = [
			{ kind: "event", id: "e1", source: "agent:r", text: "(+ 1 2)" },
		];
		const messages = await finalMessages(
			stream(
				{ messages: [{ type: "human", content: "what is 1 + 2?" }] },
				{ inbox: async () => waiting.splice(0) },
			),
		);

		expect(messages[3]).toMatchObject({
			type: "system",
			id: "e1",
			content: "(+ 1 2)",
			additional_kwargs: { source: "agent:r" },
		});
	});

	test("every model call reports what it cost, and only its own", async () => {
		const messages = await recorded({
			messages: [{ type: "human", content: "what is 1 + 2?" }],
		});

		const assistant = messages.filter((m) => m.type === "ai");
		expect(assistant.map((m) => m.content)).toEqual(["(+ 1 2)", "three."]);

		const step = assistant[0].additional_kwargs?.meta;
		expect(step).toMatchObject({ inputTokens: 10, outputTokens: 4 });
		expect(typeof step?.durationMs).toBe("number");
		expect(Date.parse(step?.at ?? "")).not.toBeNaN();
		expect(step?.cachedInputTokens).toBeUndefined();
		expect(step?.steps).toBeUndefined();

		const answer = assistant[1].additional_kwargs?.meta;
		expect(answer).toMatchObject({
			inputTokens: 20,
			outputTokens: 6,
			cachedInputTokens: 10,
			steps: 2,
		});
	});

	test("reports the turn it produced, not the history it was given", async () => {
		const recorded: Record<string, unknown>[][] = [];
		const response = stream(
			{
				messages: [
					{ type: "human", content: "what is 1 + 2?" },
					{ type: "ai", content: "an older answer" },
				],
			},
			{
				onTurn: (messages) => {
					recorded.push(messages);
				},
			},
		);
		await response.text();

		expect(recorded).toHaveLength(1);
		expect(recorded[0].map((m) => m.content)).toEqual([
			"(+ 1 2)",
			expect.any(String),
			"three.",
		]);
		expect(recorded[0].some((m) => m.content === "an older answer")).toBe(
			false,
		);
	});

	test("carries what a turn attached to a message into the next turn, its thinking included", async () => {
		const shown = {
			ui: { tag: "text", props: { text: "a widget" }, children: [] },
			display: "for the person",
		};
		const messages = await finalMessages(
			stream({
				messages: [
					{ type: "human", content: "what is 1 + 2?" },
					{
						type: "ai",
						content: "(+ 1 2)",
						additional_kwargs: {
							...shown,
							reasoning_content: "thinking out loud",
						},
					},
					{ type: "human", content: "and again?" },
				],
			}),
		);

		expect(messages[1]).toMatchObject({
			type: "ai",
			content: "(+ 1 2)",
			additional_kwargs: shown,
		});
		expect(messages[1].additional_kwargs?.reasoning_content).toBe(
			"thinking out loud",
		);
	});

	test("every model call names the model that was billed for it", async () => {
		const messages = await finalMessages(
			stream(
				{ messages: [{ type: "human", content: "what is 1 + 2?" }] },
				{ config: { provider: "digitalocean", model: "a-pinned-one" } },
			),
		);

		for (const m of messages.filter((m) => m.type === "ai"))
			expect(m.additional_kwargs?.meta).toMatchObject({
				provider: "digitalocean",
				model: "a-pinned-one",
			});
	});

	test("an unpinned call names the default it actually ran on", async () => {
		const messages = await finalMessages(
			stream({
				messages: [{ type: "human", content: "what is 1 + 2?" }],
			}),
		);

		expect(
			messages.find((m) => m.type === "ai")?.additional_kwargs?.meta,
		).toMatchObject({
			provider: DEFAULT_PROVIDER,
			model: providerSpecs[DEFAULT_PROVIDER].defaultModel,
		});
	});

	test("what a step reported rides the message the model wrote", async () => {
		const messages = await finalMessages(
			stream(
				{ messages: [{ type: "human", content: "what is 1 + 2?" }] },
				{ repl: testRepl([reporting("a step had something to say")]) },
			),
		);

		expect(
			messages.find((m) => m.type === "ai")?.additional_kwargs?.meta?.reported,
		).toEqual(["a step had something to say"]);
	});

	test("what fired before the model answered rides the user's message, on the wire before the answer", async () => {
		let revised: ReadonlyMap<number, unknown> = new Map();
		const text = await stream(
			{ messages: [{ type: "human", content: "what is 1 + 2?" }] },
			{
				repl: testRepl([hearing("a memory fired")]),
				onTurn: (_produced, touched) => {
					revised = touched;
				},
			},
		).text();
		const snapshots = records(text)
			.filter((r) => r.event === "values")
			.map((r) => (r.data as { messages: WireMessage[] }).messages);
		const answered = snapshots.findIndex((m) =>
			m.some((message) => message.type === "ai"),
		);
		const early = { messages: snapshots[answered - 1] };

		expect(early.messages[0].additional_kwargs?.meta?.heard?.[0]).toBe(
			"a memory fired",
		);
		const final = snapshots.at(-1) ?? [];
		expect(
			final.find((m) => m.type === "ai")?.additional_kwargs?.meta?.heard,
		).toBeUndefined();
		expect([...revised.keys()]).toEqual([0]);
	});

	test("what rode the user's message is stored on it, for the turns after", async () => {
		let revised: ReadonlyMap<number, WireMessage> = new Map();
		const messages = await finalMessages(
			stream(
				{ messages: [{ type: "human", content: "what is 1 + 2?" }] },
				{
					repl: testRepl([riding("you are a pirate")]),
					onTurn: (_produced, touched) => {
						revised = touched;
					},
				},
			),
		);

		expect(messages[0].content).toBe("what is 1 + 2?");
		expect(messages[0].additional_kwargs?.riding).toBe("you are a pirate");
		expect(revised.get(0)?.additional_kwargs?.riding).toBe("you are a pirate");
	});

	describe("what the user's newest message carried", () => {
		const told = () =>
			sent[0].some((m) => m.content.includes("the user also said: in hex"));

		test("reaches the extensions on the turn it was sent", async () => {
			await stream(
				{
					messages: [
						{
							type: "human",
							content: "what is 1 + 2?",
							additional_kwargs: { said: "in hex" },
						},
					],
				},
				{ repl: testRepl([receiving()]) },
			).text();

			expect(told()).toBe(true);
		});

		test("is not told again when the request ends past it", async () => {
			await stream(
				{
					messages: [
						{
							type: "human",
							content: "what is 1 + 2?",
							additional_kwargs: { said: "in hex" },
						},
						{ type: "ai", content: "(+ 1 2)" },
						{ type: "tool", content: "3" },
					],
				},
				{ repl: testRepl([receiving()]) },
			).text();

			expect(told()).toBe(false);
		});

		test("is not told when a system event is the newest message", async () => {
			await stream(
				{
					messages: [
						{
							type: "human",
							content: "what is 1 + 2?",
							additional_kwargs: { said: "in hex" },
						},
						{ type: "system", content: "a timer fired" },
					],
				},
				{ repl: testRepl([receiving()]) },
			).text();

			expect(told()).toBe(false);
		});
	});

	test("a REPL result carries no cost of its own", async () => {
		const messages = await finalMessages(
			stream({
				messages: [{ type: "human", content: "what is 1 + 2?" }],
			}),
		);

		const tool = messages.find((m) => m.type === "tool");
		expect(tool?.additional_kwargs?.meta).toBeUndefined();
	});
	test("the wire contract the app reads", async () => {
		const text = await stream({
			messages: [{ type: "human", content: "what is 1 + 2?" }],
		}).text();
		const seen = records(text);

		expect(new Set(seen.map((r) => r.event))).toEqual(
			new Set(["values", "messages"]),
		);

		const delta = seen.find((r) => r.event === "messages")?.data as unknown[];
		expect(delta).toEqual([
			{ type: "ai", id: expect.any(String), content: "(+ 1 2)" },
			{},
		]);

		const snapshot = seen.at(-1)?.data as { messages: WireMessage[] };
		expect(snapshot.messages.map((m) => m.type)).toEqual([
			"human",
			"ai",
			"tool",
			"ai",
		]);
		expect(snapshot.messages.slice(1).map((m) => m.content)).toEqual([
			"(+ 1 2)",
			"",
			"three.",
		]);
		const tool = snapshot.messages.find((m) => m.type === "tool");
		expect(tool?.additional_kwargs?.results).toBeUndefined();
	});

	test("every finished step is recorded once, with only what it added", async () => {
		const steps: WireMessage[][] = [];
		let rest: WireMessage[] = [];
		await stream(
			{ messages: [{ type: "human", content: "what is 1 + 2?" }] },
			{
				onStep: (produced) => {
					steps.push(produced);
				},
				onTurn: (unrecorded) => {
					rest = unrecorded;
				},
			},
		).text();

		expect(steps.map((step) => step.map((m) => m.type))).toEqual([
			["ai", "tool"],
			["ai"],
		]);
		expect(steps[0][0].content).toBe("(+ 1 2)");
		expect(steps[0][1].additional_kwargs?.results).toEqual(["3"]);
		expect(rest).toEqual([]);
	});

	test("a step is recorded before the next one is handed over", async () => {
		const order: string[] = [];
		await stream(
			{ messages: [{ type: "human", content: "what is 1 + 2?" }] },
			{
				onStep: async (produced) => {
					order.push(`start ${produced.length}`);
					await new Promise((resolve) => setTimeout(resolve, 5));
					order.push(`end ${produced.length}`);
				},
				onTurn: () => {
					order.push("turn");
				},
			},
		).text();

		expect(order).toEqual(["start 2", "end 2", "start 1", "end 1", "turn"]);
	});

	test("a failed turn has recorded every step it finished", async () => {
		const steps: WireMessage[][] = [];
		let failure: string | undefined;
		const response = stream(
			{ messages: [{ type: "human", content: "what is 1 + 2?" }] },
			{
				repl: testRepl([
					extension((hooks) =>
						hooks.evalStep.use((ctx, next) => {
							down = true;
							return next(ctx);
						}),
					),
				]),
				onStep: (produced) => {
					steps.push(produced);
				},
				onTurn: (_rest, _revised, failed) => {
					failure = failed;
				},
			},
		);
		await response.text();

		expect(failure).toContain("down");
		expect(steps.flat().map((m) => m.type)).toEqual(["ai", "tool"]);
	});

	test("what a step emits rides its result, and the model reads it the same after a reload", async () => {
		const first = await recorded(
			{ messages: [{ type: "human", content: "what is 1 + 2?" }] },
			{ repl: testRepl([emitting("k: the note\n")]) },
		);
		const live = sent[1].find((m) => m.content.includes("tool_result"));

		const stored = first.find((m) => m.type === "tool");
		expect(stored?.additional_kwargs?.riding).toBe("k: the note\n");
		expect(stored?.content).not.toContain("k: the note");
		expect(live?.content).toContain("k: the note");

		turn = 0;
		sent.length = 0;
		await stream({
			messages: [...first, { type: "human", content: "and 2 + 2?" }],
		}).text();
		const reloaded = sent[0].find((m) => m.content.includes("tool_result"));

		expect(reloaded?.content).toBe(live?.content);
	});

	test("a user message's eval result reaches the model as a system event after it and the wire as its own row", async () => {
		const result = {
			type: "tool",
			content: replResultContent("3", false),
			additional_kwargs: { display: "3", results: ["3"] },
		};
		const body = await stream({
			messages: [{ type: "human", content: "what is (+ 1 2)" }, result],
		}).text();

		expect(
			sent[0].filter((m) => m.role === "user").map((m) => m.content),
		).toEqual([
			"what is (+ 1 2)",
			'<system-event source="lisp-repl">the user ran the code in their message above:\n\n3</system-event>',
		]);
		const first = records(body).find((r) => r.event === "values")?.data as {
			messages: WireMessage[];
		};
		expect(first.messages.slice(0, 2)).toEqual([
			expect.objectContaining({ type: "human", content: "what is (+ 1 2)" }),
			expect.objectContaining({
				type: "tool",
				content: "",
				additional_kwargs: {},
			}),
		]);
	});
});
