import type { Threads } from "@repo/ai";
import type { Image } from "@repo/interpreter/image";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { ChildRecord, Supervisor } from "../../src/agent-repl.ts";
import { SupervisedAgents } from "../../src/agent-threads.ts";

const PARENT = "parent-1" as Id<"chats">;
const CHILD = "child-1" as Id<"chats">;

function world() {
	const seen = {
		limits: [] as unknown[],
		records: [] as { agent: ChildRecord; image?: Image }[],
		copied: [] as [string, string][],
		asked: [] as unknown[][],
		cancelled: [] as string[],
	};
	const threads = {
		spawn: async (
			parent: string,
			create: () => Promise<string>,
			limits?: unknown,
		) => {
			expect(parent).toBe(PARENT);
			seen.limits.push(limits);
			return await create();
		},
		ask: async (...args: unknown[]) => {
			seen.asked.push(args);
			return "job-1";
		},
		wait: async (job: string) =>
			job === "job-1"
				? { answer: "found it" }
				: { stopped: "lost in a restart" },
		state: (id: string) =>
			id === "job-1"
				? { job: id, state: "done", outcome: { answer: "found it" } }
				: { thread: id, state: "busy" },
		cancel: async (id: string) => {
			seen.cancelled.push(id);
			return true;
		},
	} as unknown as Threads;
	const supervisor: Supervisor = {
		threads,
		spawn: async (_parent, agent, image) => {
			seen.records.push(image === undefined ? { agent } : { agent, image });
			return CHILD;
		},
		copyTranscript: async (from, to) => {
			seen.copied.push([from, to]);
		},
	};
	return { seen, agents: new SupervisedAgents(supervisor, PARENT) };
}

describe("the agent threads adapter", () => {
	it("spawns a child record under the parent with its budget as limits", async () => {
		const { seen, agents } = world();
		const child = await agents.spawn({
			definition: {
				name: "lead",
				prompt: "lead",
				permissions: "(permission/deny memory/*)",
				roster: ["scout"],
				budget: 12,
			},
			seed: { from: "fresh" },
			chat: { from: "fresh" },
		});
		expect(child).toBe(CHILD);
		expect(seen.records).toEqual([
			{
				agent: {
					name: "lead",
					prompt: "lead",
					bounds: ["(permission/deny memory/*)"],
					roster: ["scout"],
					budget: 12,
				},
			},
		]);
		expect(seen.limits).toEqual([{ steps: 12 }]);
		expect(seen.copied).toEqual([]);
	});

	it("forks the image and copies the transcript when asked", async () => {
		const { seen, agents } = world();
		const image = { version: 1 } as unknown as Image;
		await agents.spawn({
			definition: { name: "s", prompt: "p" },
			seed: { from: "fork", image },
			chat: { from: "fork" },
		});
		expect(seen.records[0]?.image).toBe(image);
		expect(seen.copied).toEqual([[PARENT, CHILD]]);
	});

	it("sends an event to the child that replies to the parent", async () => {
		const { seen, agents } = world();
		expect(await agents.send(CHILD, { text: "dig", maxSteps: 4 })).toBe(
			"job-1",
		);
		expect(seen.asked).toEqual([
			[
				CHILD,
				{
					kind: "event",
					id: expect.any(String),
					source: `agent:${PARENT}`,
					text: "dig",
				},
				{ replyTo: PARENT, maxSteps: 4 },
			],
		]);
	});

	it("reads waits, states and cancels off the supervisor", async () => {
		const { seen, agents } = world();
		const signal = new AbortController().signal;
		expect(await agents.wait("job-1", signal)).toEqual({ reply: "found it" });
		expect(await agents.wait("job-2", signal)).toEqual({
			failure: "lost in a restart",
		});
		expect(agents.state("job-1")).toEqual({
			state: "done",
			outcome: { reply: "found it" },
		});
		expect(agents.state(CHILD)).toEqual({ state: "pending" });
		expect(await agents.cancel(CHILD)).toBe(true);
		expect(seen.cancelled).toEqual([CHILD]);
	});
});
