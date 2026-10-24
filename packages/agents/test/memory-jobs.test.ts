import type { Image } from "@repo/interpreter/image";
import { describe, expect, test } from "vitest";
import { MemoryJobs } from "../src/memory-jobs.ts";
import type { AgentRunner, Ask, CodeRunner, Notice } from "../src/ports.ts";

function world() {
	const asked: Ask[] = [];
	const held: (() => void)[] = [];
	const agents: AgentRunner = {
		spawn: async (spawn) => `id-of-${spawn.definition.name}`,
		async send(agent, ask) {
			asked.push(ask);
			if (ask.message === "fail") throw new Error("it broke");
			if (ask.message === "hold")
				await new Promise<void>((resolve, reject) => {
					held.push(resolve);
					ask.signal.addEventListener("abort", () => reject(ask.signal.reason));
				});
			return `${agent} got ${ask.message}`;
		},
	};
	const code: CodeRunner = {
		run: async ({ source }) => `printed ${source}`,
	};
	const notices: Notice[] = [];
	let next = 0;
	const jobs = new MemoryJobs(
		{ agents, code },
		(notice) => notices.push(notice),
		() => `id-${++next}`,
	);
	const send = (message: string) =>
		jobs.submit({ kind: "agent", agent: "a", name: "r", message, maxSteps: 5 });
	const never = new AbortController().signal;
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
	return { jobs, asked, held, notices, send, never, settle };
}

describe("in-memory jobs", () => {
	test("hand an unclaimed reply to the host once it lands", async () => {
		const { send, notices, settle } = world();
		send("hello");
		await settle();
		expect(notices).toEqual([{ source: "agent:r", text: "a got hello" }]);
	});

	test("keep a reply someone waited on to the waiter", async () => {
		const { jobs, send, notices, never, settle } = world();
		expect(await jobs.wait(send("hello"), never)).toEqual({
			reply: "a got hello",
		});
		await settle();
		expect(notices).toEqual([]);
	});

	test("hand a failure over as a failure, and keep it", async () => {
		const { jobs, send, notices, settle } = world();
		const job = send("fail");
		await settle();
		expect(jobs.peek(job)).toEqual({
			state: "failed",
			outcome: { failure: "it broke" },
		});
		expect(notices).toEqual([{ source: "agent:r", text: "failed: it broke" }]);
	});

	test("run the messages to one agent in turn", async () => {
		const { jobs, send, asked, held, settle } = world();
		const first = send("hold");
		const second = send("next");
		await settle();
		expect(asked.map((ask) => ask.message)).toEqual(["hold"]);
		expect([jobs.peek(first)?.state, jobs.peek(second)?.state]).toEqual([
			"running",
			"queued",
		]);
		held[0]();
		await settle();
		expect([jobs.peek(first)?.state, jobs.peek(second)?.state]).toEqual([
			"done",
			"done",
		]);
	});

	test("run code and say so under the job's own id", async () => {
		const { jobs, notices, settle } = world();
		const job = jobs.submit({
			kind: "code",
			source: "(+ 1 2)",
			image: {} as Image,
		});
		await settle();
		expect(notices).toEqual([
			{ source: `job:${job}`, text: "printed (+ 1 2)" },
		]);
	});

	test("cancel a job that has not finished, and say nothing of it", async () => {
		const { jobs, send, notices, settle } = world();
		const job = send("hold");
		await settle();
		expect(jobs.cancel(job)).toBe(true);
		await settle();
		expect(jobs.peek(job)?.state).toBe("cancelled");
		expect(jobs.cancel(job)).toBe(false);
		expect(notices).toEqual([]);
	});

	test("hand the reply over after all when the waiter gives up", async () => {
		const { jobs, send, held, notices, settle } = world();
		const job = send("hold");
		const stop = new AbortController();
		const waiting = jobs.wait(job, stop.signal);
		stop.abort(new Error("turn ended"));
		await expect(waiting).rejects.toThrow("turn ended");
		await settle();
		held[0]();
		await settle();
		expect(notices).toEqual([{ source: "agent:r", text: "a got hold" }]);
	});

	test("know nothing of a job they never took", () => {
		expect(world().jobs.peek("nope")).toBeUndefined();
	});
});
