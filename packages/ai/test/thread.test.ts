import type { ChatMessage } from "@repo/shared/messages";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentDelta } from "../src/agent.ts";
import { type Envelope, MemoryMailbox } from "../src/mailbox.ts";
import type { ChatMessageInput, WireMessage } from "../src/stream.ts";
import { Thread, type TranscriptStore } from "../src/thread.ts";
import { testRepl } from "./helpers.ts";

const model = vi.hoisted(() => ({
	script: [] as string[],
	calls: [] as ChatMessage[][],
	gate: undefined as Promise<void> | undefined,
	entered: undefined as (() => void) | undefined,
}));

vi.mock("../src/telemetry.ts", () => ({
	captureReplEval: () => {},
	captureTurn: () => {},
	captureLlmCall: () => {},
	captureException: () => {},
}));

vi.mock("../src/agent.ts", () => ({
	streamAgent: async function* (
		messages: ChatMessage[],
	): AsyncGenerator<AgentDelta> {
		const reply = model.script[model.calls.length] ?? "done.";
		model.calls.push(messages);
		model.entered?.();
		if (model.gate !== undefined) await model.gate;
		yield { text: reply };
	},
}));

beforeEach(() => {
	model.script = [];
	model.calls = [];
	model.gate = undefined;
	model.entered = undefined;
});

class World implements TranscriptStore {
	readonly stored: WireMessage[] = [];
	readonly turns: string[] = [];
	running = 0;
	overlapped = false;
	onAppend: (messages: WireMessage[]) => void = () => {};

	async read(): Promise<ChatMessageInput[]> {
		return this.stored.map((m) => ({ ...m }));
	}

	async append(_id: string, messages: WireMessage[]): Promise<void> {
		this.stored.push(...messages);
		this.onAppend(messages);
	}

	async annotate(): Promise<void> {}

	thread(): Thread {
		return new Thread("t1", {
			mailbox: new MemoryMailbox(),
			repl: () => testRepl(),
			transcript: this,
			status: {
				start: async () => {
					this.running += 1;
					if (this.running > 1) this.overlapped = true;
					this.turns.push("start");
				},
				settle: async () => {
					this.running -= 1;
					this.turns.push("settle");
				},
			},
			setup: async () => ({ runsForms: true }),
		});
	}
}

function user(id: string, text: string): Envelope {
	return { kind: "user", id, text, forms: true };
}

function gated(): { open: () => void; entered: Promise<void> } {
	let open: () => void = () => {};
	model.gate = new Promise((done) => {
		open = done;
	});
	const entered = new Promise<void>((done) => {
		model.entered = done;
	});
	return { open, entered };
}

describe("a thread", () => {
	test("runs one turn at a time", async () => {
		const world = new World();
		const thread = world.thread();
		const gate = gated();
		const first = await thread.post(user("a", "hello"));
		await gate.entered;
		const second = await thread.post(user("b", "again"));
		gate.open();
		await Promise.all([first.ended, second.ended]);
		expect(world.overlapped).toBe(false);
	});

	test("hands a post made during a turn to its next step", async () => {
		const world = new World();
		const thread = world.thread();
		model.script = ["(+ 1 2)", "three."];
		const gate = gated();
		const first = await thread.post(user("a", "what is 1 + 2?"));
		await gate.entered;
		const second = await thread.post(user("b", "use hex"));
		gate.open();

		expect(await second.opened).toBeUndefined();
		expect(await first.ended).toEqual({ answer: "three." });
		expect(await second.ended).toEqual({ answer: "three." });
		expect(world.turns).toEqual(["start", "settle"]);
		expect(model.calls[1].at(-1)).toMatchObject({ content: "use hex" });
	});

	test("starts a new turn for a post that arrives after the last step", async () => {
		const world = new World();
		const thread = world.thread();
		let late: Promise<{ ended: Promise<unknown> }> | undefined;
		world.onAppend = (messages) => {
			if (late === undefined && messages.some((m) => m.type === "ai"))
				late = thread.post(user("b", "one more thing"));
		};
		const first = await thread.post(user("a", "hello"));
		expect(await first.ended).toEqual({ answer: "done." });
		expect(late).toBeDefined();
		await (await late)?.ended;

		expect(world.turns).toEqual(["start", "settle", "start", "settle"]);
		expect(model.calls).toHaveLength(2);
	});

	test("streams the turn a watched post opens", async () => {
		const world = new World();
		const opened = await (
			await world.thread().post(user("a", "hello"), { watch: true })
		).opened;
		expect(await opened?.text()).toContain("event: values");
	});

	test("never runs an event as lisp", async () => {
		const world = new World();
		const thread = world.thread();
		const posted = await thread.post({
			kind: "event",
			id: "e1",
			source: "agent:r",
			text: "(+ 40 2)",
		});
		await posted.ended;

		expect(world.stored[0]).toMatchObject({ type: "system", id: "e1" });
		expect(world.stored[1]).toMatchObject({ type: "ai" });
		expect(model.calls[0].at(-1)?.content).toContain(
			'<system-event source="agent:r">(+ 40 2)</system-event>',
		);
	});

	test("runs the forms of a user's message before the turn", async () => {
		const world = new World();
		const posted = await world.thread().post(user("a", "(+ 40 2)"));
		await posted.ended;

		expect(world.stored[1]).toMatchObject({
			type: "tool",
			additional_kwargs: { results: ["42"] },
		});
	});

	test("lets a waiting post be withdrawn", async () => {
		const world = new World();
		const thread = world.thread();
		const gate = gated();
		const first = await thread.post(user("a", "hello"));
		await gate.entered;
		const second = await thread.post(user("b", "never mind"));
		expect(await thread.withdraw("b")).toBe(true);
		gate.open();
		await first.ended;
		expect(await second.ended).toEqual({
			stopped: "withdrawn before a turn took it",
		});
		expect(model.calls).toHaveLength(1);
	});
});
