import type { InterpExtension } from "@repo/interpreter/session";
import type { AgentRepl } from "@repo/repl/repl";
import type { ChatMessage } from "@repo/shared/messages";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentDelta } from "../src/agent.ts";
import { type Envelope, MemoryMailbox } from "../src/mailbox.ts";
import type { ChatMessageInput, WireMessage } from "../src/stream.ts";
import { type Lineage, Threads, type ThreadsOptions } from "../src/threads.ts";
import { holding, testRepl } from "./helpers.ts";

const model = vi.hoisted(() => ({
	script: [] as string[],
	calls: [] as ChatMessage[][],
	gate: undefined as Promise<void> | undefined,
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
		if (model.gate !== undefined) await model.gate;
		yield { text: reply };
		yield { usage: { input: 10, output: 5 } };
	},
}));

beforeEach(() => {
	model.script = [];
	model.calls = [];
	model.gate = undefined;
});

class World {
	readonly stored = new Map<string, WireMessage[]>();
	readonly lineages = new Map<string, Lineage>();
	readonly opened: string[] = [];
	extensions: InterpExtension[] = [];

	threads(options?: ThreadsOptions): Threads {
		return new Threads(
			{
				ports: {
					mailbox: new MemoryMailbox(),
					transcript: {
						read: async (id): Promise<ChatMessageInput[]> =>
							(this.stored.get(id) ?? []).map((m) => ({ ...m })),
						append: async (id, messages) => {
							this.stored.set(id, [
								...(this.stored.get(id) ?? []),
								...messages,
							]);
						},
						annotate: async () => {},
					},
					status: { start: async () => {}, settle: async () => {} },
					setup: async () => ({ runsForms: true }),
				},
				repl: async (id): Promise<AgentRepl> => {
					this.opened.push(id);
					await Promise.resolve();
					return testRepl(this.extensions);
				},
				lineage: (id) => this.lineages.get(id) ?? {},
			},
			options,
		);
	}

	heard(id: string, source: string): boolean {
		return (this.stored.get(id) ?? []).some(
			(m) => m.additional_kwargs?.source === source,
		);
	}
}

function user(text: string): Envelope {
	return { kind: "user", id: crypto.randomUUID(), text, forms: false };
}

function gate(): () => void {
	let open: () => void = () => {};
	model.gate = new Promise((done) => {
		open = done;
	});
	return open;
}

function family(world: World): void {
	world.lineages.set("child", { parent: "root", title: "child" });
	world.lineages.set("grand", { parent: "child", title: "grand" });
}

describe("threads", () => {
	test("hand the same thread the same repl, opened once however many race", async () => {
		const world = new World();
		const threads = world.threads();
		const [a, b] = await Promise.all([threads.repl("t"), threads.repl("t")]);
		expect(a).toBe(b);
		expect(world.opened).toEqual(["t"]);
		await a.eval("(setq x 41)");
		expect(await (await threads.repl("u")).eval("(echo x)")).toContain(
			"void variable: x",
		);
	});

	test("reopen a thread through the host once it was evicted idle", async () => {
		const world = new World();
		const threads = world.threads({ maxLive: 1 });
		const first = threads.get("a");
		threads.get("b");
		expect(threads.get("a")).not.toBe(first);
	});

	test("never evict a running thread", async () => {
		const world = new World();
		const threads = world.threads({ maxLive: 1 });
		const open = gate();
		const running = threads.get("a");
		const posted = await running.post(user("hello"));
		await vi.waitFor(() => expect(model.calls).toHaveLength(1));
		threads.get("b");
		threads.get("c");
		expect(threads.get("a")).toBe(running);
		open();
		await posted.ended;
	});

	test("never evict a thread that holds a paused step", async () => {
		const world = new World();
		world.extensions = [holding()];
		model.script = ["(wait-for-human)"];
		const threads = world.threads({ maxLive: 1 });
		const paused = threads.get("a");
		const posted = await paused.post(user("ask first"));
		expect("held" in (await posted.ended)).toBe(true);
		threads.get("b");
		threads.get("c");
		expect(threads.get("a")).toBe(paused);
	});

	test("send a reply to its return address three levels down", async () => {
		const world = new World();
		family(world);
		const threads = world.threads();
		await threads.ask("child", user("start"), { replyTo: "root" });
		await vi.waitFor(() =>
			expect(world.heard("root", "agent:child")).toBe(true),
		);
		const rootHeard = () =>
			(world.stored.get("root") ?? []).filter(
				(m) => m.additional_kwargs?.source === "agent:child",
			).length;
		expect(rootHeard()).toBe(1);

		await threads.ask("grand", user("dig"), { replyTo: "child" });

		await vi.waitFor(() =>
			expect(world.heard("child", "agent:grand")).toBe(true),
		);
		await vi.waitFor(() => expect(rootHeard()).toBe(2));
	});

	test("hand a waiter the reply instead of its return address", async () => {
		const world = new World();
		family(world);
		const threads = world.threads();
		const job = await threads.ask("child", user("start"), { replyTo: "root" });
		expect(await threads.wait(job)).toEqual({ answer: "done." });
		expect(threads.state(job)).toMatchObject({ state: "done" });
		expect(world.stored.has("root")).toBe(false);
	});

	test("report a job unknown after a restart as lost", async () => {
		const world = new World();
		const before = world.threads();
		const job = await before.ask("child", user("start"));
		const restarted = world.threads();
		expect(restarted.state(job)).toMatchObject({
			state: "lost",
			outcome: { stopped: "lost in a restart" },
		});
		expect(await restarted.wait(job)).toEqual({
			stopped: "lost in a restart",
		});
	});

	test("refuse a spawn past the depth cap", async () => {
		const world = new World();
		family(world);
		const threads = world.threads({ maxDepth: 2 });
		const create = vi.fn(async () => "new");
		await expect(threads.spawn("grand", create)).rejects.toThrow(/too deep/);
		expect(create).not.toHaveBeenCalled();
		expect(await threads.spawn("child", create)).toBe("new");
		expect(await threads.ancestors("new")).toEqual(["child", "root"]);
	});

	test("cancel a thread's turn and every descendant's, with what waits for them", async () => {
		const world = new World();
		family(world);
		const threads = world.threads();
		const open = gate();
		const child = await threads.get("child").post(user("work"));
		const grand = await threads.get("grand").post(user("dig"));
		const queued = await threads.get("grand").post(user("then this"));
		await vi.waitFor(() => expect(model.calls).toHaveLength(2));

		expect(await threads.cancel("root")).toBe(true);
		expect(await queued.ended).toEqual({ stopped: "cancelled" });
		open();
		expect(await child.ended).not.toEqual({ answer: "done." });
		expect(await grand.ended).not.toEqual({ answer: "done." });
		expect(model.calls).toHaveLength(2);
	});
});

describe("a thread's budget", () => {
	test("never grants a child more than its parent has left", async () => {
		const world = new World();
		world.lineages.set("root", { limits: { steps: 5 } });
		world.lineages.set("child", { parent: "root", limits: { steps: 50 } });
		const threads = world.threads();
		await threads.lineage("root");
		threads.budget.charge("root", { steps: 3 });
		await threads.lineage("child");
		expect(threads.budget.remaining("child").steps).toBe(2);
	});

	test("caps a child's turn at its parent's steps and bills the parent", async () => {
		const world = new World();
		world.lineages.set("root", { limits: { steps: 2, tokens: 1000 } });
		world.lineages.set("child", { parent: "root" });
		model.script = ["(+ 1 2)", "(+ 1 2)", "(+ 1 2)", "done."];
		const threads = world.threads();
		const posted = await threads.get("child").post(user("count"));
		expect(await posted.ended).toEqual({
			stopped: "used its 2 steps without answering",
		});
		expect(threads.budget.remaining("root")).toEqual({ steps: 0, tokens: 970 });
		const again = await threads.get("child").post(user("more"));
		expect(await again.ended).toMatchObject({
			stopped: expect.stringContaining("out of steps"),
		});
	});
});
