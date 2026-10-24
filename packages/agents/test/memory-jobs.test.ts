import { describe, expect, test } from "vitest";
import { MemoryAgentJobs } from "../src/memory-jobs.ts";
import type { AgentRunner, Ask, Notice, Spawn } from "../src/ports.ts";

function world() {
	const asked: Ask[] = [];
	const held: (() => void)[] = [];
	const runner: AgentRunner = {
		spawn: (spawn: Spawn) => ({
			async send(ask) {
				asked.push(ask);
				if (ask.message === "fail") throw new Error("it broke");
				if (ask.message === "hold")
					await new Promise<void>((resolve, reject) => {
						held.push(resolve);
						ask.signal.addEventListener("abort", () =>
							reject(ask.signal.reason),
						);
					});
				return `${spawn.definition.name} got ${ask.message}`;
			},
		}),
	};
	const notices: Notice[] = [];
	let next = 0;
	const jobs = new MemoryAgentJobs(
		runner,
		(notice) => notices.push(notice),
		() => `id-${++next}`,
	);
	const agent = jobs.spawn({
		definition: { name: "r", prompt: "p" },
		seed: { from: "fresh" },
		chat: { from: "fresh" },
	});
	const send = (message: string) => jobs.send(agent, { message, maxSteps: 5 });
	const never = new AbortController().signal;
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
	return { jobs, asked, held, notices, send, never, settle };
}

describe("in-memory agent jobs", () => {
	test("hand an unclaimed reply to the host once it lands", async () => {
		const { send, notices, settle } = world();
		send("hello");
		await settle();
		expect(notices).toEqual([{ source: "agent:r", text: "r got hello" }]);
	});

	test("keep a reply someone waited on to the waiter", async () => {
		const { jobs, send, notices, never, settle } = world();
		expect(await jobs.wait(send("hello"), never)).toEqual({
			reply: "r got hello",
		});
		await settle();
		expect(notices).toEqual([]);
	});

	test("hand a failure over as a failure", async () => {
		const { jobs, send, notices, settle } = world();
		const job = send("fail");
		await settle();
		expect(jobs.state(job)).toBe("failed");
		expect(notices).toEqual([{ source: "agent:r", text: "failed: it broke" }]);
	});

	test("run the messages to one agent in turn", async () => {
		const { jobs, send, asked, held, settle } = world();
		const first = send("hold");
		const second = send("next");
		await settle();
		expect(asked.map((ask) => ask.message)).toEqual(["hold"]);
		expect([jobs.state(first), jobs.state(second)]).toEqual([
			"running",
			"queued",
		]);
		held[0]();
		await settle();
		expect([jobs.state(first), jobs.state(second)]).toEqual(["done", "done"]);
	});

	test("cancel a job that has not finished, and say nothing of it", async () => {
		const { jobs, send, notices, settle } = world();
		const job = send("hold");
		await settle();
		expect(jobs.cancel(job)).toBe(true);
		await settle();
		expect(jobs.state(job)).toBe("cancelled");
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
		expect(notices).toEqual([{ source: "agent:r", text: "r got hold" }]);
	});

	test("refuse a job they never took", () => {
		expect(() => world().jobs.state("nope")).toThrow("no agent job nope");
	});
});
