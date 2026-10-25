import type { ChatMessage } from "@repo/shared/messages";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentDelta } from "../src/agent.ts";
import { type Envelope, MemoryMailbox } from "../src/mailbox.ts";
import type { ChatMessageInput, WireMessage } from "../src/stream.ts";
import { Thread, type TranscriptStore, type TurnSetup } from "../src/thread.ts";
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
	broken = false;
	setup: TurnSetup = { runsForms: true };

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
			repl: () => {
				if (this.broken) throw new Error("no repl here");
				return testRepl();
			},
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
			setup: async () => this.setup,
		});
	}
}

function user(id: string, text: string): Envelope {
	return { kind: "user", id, text, forms: true };
}

class Watched {
	private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
	private readonly decoder = new TextDecoder();
	text = "";

	constructor(response: Response) {
		const body = response.body;
		if (body === null) throw new Error("the watch has no body");
		this.reader = body.getReader();
	}

	async until(seen: (text: string) => boolean): Promise<string> {
		while (!seen(this.text)) {
			const { done, value } = await this.reader.read();
			if (done)
				throw new Error(`the watch ended before it saw enough:\n${this.text}`);
			this.text += this.decoder.decode(value, { stream: true });
		}
		return this.text;
	}

	async ended(): Promise<boolean> {
		return (await this.reader.read()).done;
	}
}

function statuses(text: string): string[] {
	return [...text.matchAll(/event: status\ndata: (.*)\n/g)].map(
		([, data]) => (JSON.parse(data) as { status: string }).status,
	);
}

const settledTwice = (text: string) =>
	statuses(text).filter((status) => status !== "running").length >= 2;

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
	test("caps a turn at the tighter of its post's and its setup's steps", async () => {
		const world = new World();
		world.setup = { runsForms: true, maxSteps: 2 };
		model.script = ["(+ 1 2)", "(+ 1 2)", "(+ 1 2)", "done."];
		const posted = await world.thread().post(user("a", "go"), { maxSteps: 3 });
		expect(await posted.ended).toEqual({
			stopped: "used its 2 steps without answering",
		});
	});

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

describe("a thread's watchers", () => {
	test("see a turn they did not start", async () => {
		const world = new World();
		const thread = world.thread();
		const watched = new Watched(thread.watch());
		await (await thread.post(user("a", "hello"))).ended;
		const text = await watched.until(settledTwice);

		expect(text).toContain("event: values");
		expect(text).toContain("done.");
	});

	test("get the turn so far when they attach mid-turn", async () => {
		const world = new World();
		const thread = world.thread();
		const gate = gated();
		const posted = await thread.post(user("a", "hello"));
		await gate.entered;
		const watched = new Watched(thread.watch());
		const sofar = await watched.until((text) => text.includes("hello"));

		expect(statuses(sofar)).toEqual(["running"]);
		expect(sofar).toContain("event: values");
		gate.open();
		await posted.ended;
		expect(
			await watched.until((text) => statuses(text).includes("idle")),
		).toContain("done.");
	});

	test("are told each status the thread passes through", async () => {
		const world = new World();
		const thread = world.thread();
		const watched = new Watched(thread.watch());
		await (await thread.post(user("a", "hello"))).ended;
		world.broken = true;
		await (await thread.post(user("b", "again"))).ended;
		const text = await watched.until((seen) =>
			statuses(seen).includes("errored"),
		);

		expect(statuses(text)).toEqual([
			"idle",
			"running",
			"idle",
			"running",
			"errored",
		]);
		expect(text).toContain("no repl here");
	});

	test("see a message relayed from another thread", async () => {
		const world = new World();
		const thread = world.thread();
		const watched = new Watched(thread.watch());
		await (
			await thread.post({
				kind: "event",
				id: "e1",
				source: "agent:r",
				text: "found it",
			})
		).ended;
		thread.relay({ id: "ask", type: "tool", content: "agent r is waiting" });
		const text = await watched.until((seen) =>
			seen.includes("agent r is waiting"),
		);

		expect(text).toMatch(
			/event: relayed\ndata: .*"id":"e1".*"source":"agent:r"/,
		);
		expect(text).toMatch(/event: relayed\ndata: .*"id":"ask"/);
	});

	test("are let go when their signal aborts", async () => {
		const world = new World();
		const watching = new AbortController();
		const watched = new Watched(world.thread().watch(watching.signal));
		await watched.until((text) => text.includes("idle"));
		watching.abort();
		expect(await watched.ended()).toBe(true);
	});
});

describe("stopping a thread", () => {
	test("aborts the turn that runs, and only one that runs", async () => {
		const world = new World();
		const thread = world.thread();
		expect(thread.stop()).toBe(false);
		const gate = gated();
		const posted = await thread.post(user("a", "hello"));
		await gate.entered;
		expect(thread.stop()).toBe(true);
		gate.open();
		expect(await posted.ended).not.toEqual({ answer: "done." });
		expect(thread.stop()).toBe(false);
	});
});
