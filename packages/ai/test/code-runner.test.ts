import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type { InterpExtension } from "@repo/interpreter/session";
import type { AgentRepl } from "@repo/repl/repl";
import type { ChatMessage } from "@repo/shared/messages";
import { describe, expect, test, vi } from "vitest";
import type { AgentDelta } from "../src/agent.ts";
import { type Envelope, MemoryMailbox } from "../src/mailbox.ts";
import { codeRunner } from "../src/runner.ts";
import type { ChatMessageInput, WireMessage } from "../src/stream.ts";
import type { TurnSetup } from "../src/thread.ts";
import { type Lineage, Threads } from "../src/threads.ts";
import { holding, testRepl } from "./helpers.ts";

vi.mock("../src/telemetry.ts", () => ({
	captureReplEval: () => {},
	captureTurn: () => {},
	captureLlmCall: () => {},
	captureException: () => {},
}));

vi.mock("../src/agent.ts", () => ({
	streamAgent: async function* (
		_messages: ChatMessage[],
	): AsyncGenerator<AgentDelta> {
		yield { text: "done." };
	},
}));

const stalling: InterpExtension = (interp: Interp) => {
	interp.defineGlobal(
		newSym("stall"),
		interp.makeBuiltIn("stall", 0, () => new Promise(() => {})),
	);
};

class World {
	readonly stored = new Map<string, WireMessage[]>();
	readonly lineages = new Map<string, Lineage>();
	readonly setups = new Map<string, TurnSetup>();

	threads(): Threads {
		return new Threads({
			ports: {
				mailbox: new MemoryMailbox(),
				transcript: {
					read: async (id): Promise<ChatMessageInput[]> =>
						(this.stored.get(id) ?? []).map((m) => ({ ...m })),
					append: async (id, messages) => {
						this.stored.set(id, [...(this.stored.get(id) ?? []), ...messages]);
					},
					annotate: async () => {},
				},
				status: { start: async () => {}, settle: async () => {} },
				setup: async (id) => this.setups.get(id) ?? { runsForms: true },
			},
			repl: async (): Promise<AgentRepl> => testRepl([stalling, holding()]),
			lineage: (id) => this.lineages.get(id) ?? {},
		});
	}

	job(code: string, deadlineMs?: number): void {
		this.lineages.set("job", { parent: "root", title: "job" });
		this.setups.set("job", {
			runsForms: false,
			runner: codeRunner(code),
			...(deadlineMs === undefined ? {} : { deadlineMs }),
		});
	}

	heard(id: string, source: string): WireMessage | undefined {
		return (this.stored.get(id) ?? []).find(
			(m) => m.additional_kwargs?.source === source,
		);
	}
}

function start(): Envelope {
	return { kind: "event", id: crypto.randomUUID(), source: "test", text: "go" };
}

describe("a code runner", () => {
	test("end the turn with what the form printed", async () => {
		const world = new World();
		world.job("(+ 40 2)");
		const threads = world.threads();
		const job = await threads.ask("job", start());
		expect(await threads.wait(job)).toEqual({ answer: "42" });
		expect(threads.state(job)).toMatchObject({ state: "done" });
	});

	test("fail the job when the form raises", async () => {
		const world = new World();
		world.job('(error "boom")');
		const threads = world.threads();
		const job = await threads.ask("job", start());
		const outcome = await threads.wait(job);
		expect(outcome).toMatchObject({ stopped: expect.stringContaining("boom") });
		expect(threads.state(job)).toMatchObject({ state: "failed" });
	});

	test("wake the parent with the result as an event under its own source", async () => {
		const world = new World();
		world.job("(* 6 7)");
		const threads = world.threads();
		const job = await threads.ask("job", start(), {
			replyTo: "root",
			replyAs: "background",
		});
		await vi.waitFor(() =>
			expect(world.heard("root", `background:${job}`)?.content).toContain("42"),
		);
	});

	test("stop at the deadline its setup carries", async () => {
		const world = new World();
		world.job("(stall)", 20);
		const threads = world.threads();
		const job = await threads.ask("job", start());
		expect(await threads.wait(job)).toEqual({
			stopped: "failed: the code ran past its deadline",
		});
	});

	test("stop when the job is cancelled", async () => {
		const world = new World();
		world.job("(stall)");
		const threads = world.threads();
		const job = await threads.ask("job", start(), { replyTo: "root" });
		await vi.waitFor(() =>
			expect(threads.state("job")).toMatchObject({ state: "busy" }),
		);
		await new Promise((settle) => setTimeout(settle, 20));
		expect(await threads.cancel(job)).toBe(true);
		expect(threads.state(job)).toMatchObject({ state: "cancelled" });
		await vi.waitFor(() =>
			expect(threads.state("job")).toMatchObject({ state: "idle" }),
		);
		expect(world.stored.has("root")).toBe(false);
	});

	test("surface a held step in the root chat", async () => {
		const world = new World();
		world.job("(wait-for-human)");
		const threads = world.threads();
		const job = await threads.ask("job", start(), { replyTo: "root" });
		await vi.waitFor(() =>
			expect(threads.state(job)).toMatchObject({ state: "held" }),
		);
		expect(
			(world.stored.get("root") ?? []).some(
				(m) => m.additional_kwargs?.thread === "job",
			),
		).toBe(true);
	});
});
