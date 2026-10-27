import type { Threads } from "@repo/ai";
import { extract, type Image, snapshot } from "@repo/interpreter/image";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { ChildRecord, Supervisor } from "../../src/agent-repl.ts";
import { SupervisedAgents } from "../../src/agent-threads.ts";

const PARENT = "parent-1" as Id<"chats">;
const CHILD = "child-1" as Id<"chats">;
const STORED = "child-0" as Id<"chats">;

function world() {
	const seen = {
		limits: [] as unknown[],
		titles: [] as string[],
		records: [] as { agent: ChildRecord; image?: Image }[],
		copied: [] as [string, string][],
		asked: [] as unknown[][],
		cancelled: [] as string[],
		imaged: [] as [string, string][],
		looked: [] as string[],
		jobs: new Map<string, string>(),
		stored: undefined as Image | undefined,
	};
	const threads = {
		spawn: async (
			parent: string,
			title: string,
			create: () => Promise<string>,
			limits?: unknown,
		) => {
			expect(parent).toBe(PARENT);
			seen.titles.push(title);
			seen.limits.push(limits);
			return await create();
		},
		ask: async (...args: unknown[]) => {
			seen.asked.push(args);
			seen.jobs.set(args[0] as string, "job-1");
			return "job-1";
		},
		latest: (thread: string) => seen.jobs.get(thread),
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
		child: async (parent, name) => {
			expect(parent).toBe(PARENT);
			seen.looked.push(name);
			return name === "earlier" ? STORED : undefined;
		},
		image: async (parent, child) => {
			seen.imaged.push([parent, child]);
			return child === CHILD ? seen.stored : undefined;
		},
	};
	return { seen, agents: new SupervisedAgents(supervisor, PARENT) };
}

const fresh = { seed: { from: "fresh" }, chat: { from: "fresh" } } as const;

describe("the agent threads adapter", () => {
	it("spawns a child record under the parent, titled by its name, with its budget as limits", async () => {
		const { seen, agents } = world();
		await agents.spawn({
			definition: {
				name: "lead",
				prompt: "lead",
				permissions: "(permission/deny memory/*)",
				roster: ["scout"],
				budget: 12,
			},
			...fresh,
		});
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
		expect(seen.titles).toEqual(["lead"]);
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

	it("sends to the child by its name, from the parent by name, never an id", async () => {
		const { seen, agents } = world();
		await agents.spawn({ definition: { name: "r", prompt: "p" }, ...fresh });
		await agents.send("r", { text: "dig", maxSteps: 4 });
		expect(seen.asked).toEqual([
			[
				CHILD,
				{
					kind: "event",
					id: expect.any(String),
					source: "agent:parent",
					text: "dig",
				},
				{ replyTo: PARENT, maxSteps: 4 },
			],
		]);
		expect(seen.looked).toEqual([]);
	});

	it("waits on and reads the state of the last job sent to a name", async () => {
		const { agents } = world();
		await agents.spawn({ definition: { name: "r", prompt: "p" }, ...fresh });
		const signal = new AbortController().signal;
		expect(await agents.state("r")).toEqual({ state: "idle" });
		expect(await agents.wait("r", signal)).toEqual({
			failure: "that agent was sent nothing since the runtime started",
		});
		await agents.send("r", { text: "dig", maxSteps: 4 });
		expect(await agents.wait("r", signal)).toEqual({ reply: "found it" });
		expect(await agents.state("r")).toEqual({
			state: "done",
			outcome: { reply: "found it" },
		});
	});

	it("cancels the last job sent to a name, queued or running, then its thread", async () => {
		const { seen, agents } = world();
		await agents.spawn({ definition: { name: "r", prompt: "p" }, ...fresh });
		await agents.send("r", { text: "dig", maxSteps: 4 });
		expect(await agents.cancel("r")).toBe(true);
		expect(seen.cancelled).toEqual(["job-1", CHILD]);
	});

	it("finds a child spawned before a restart by its name in the store", async () => {
		const { seen, agents } = world();
		expect(await agents.cancel("earlier")).toBe(true);
		expect(seen.cancelled).toEqual([STORED]);
		expect(seen.looked).toEqual(["earlier"]);
		await expect(agents.cancel("nobody")).rejects.toThrow(
			"no agent named nobody",
		);
	});

	it("reads one global out of the named child's stored image, as the parent's child", async () => {
		const { seen, agents } = world();
		await agents.spawn({ definition: { name: "r", prompt: "p" }, ...fresh });
		const child = new Interp();
		runSync(child, "(setq rows (list 1 2) other 3)");
		seen.stored = snapshot(child);
		expect(await agents.read("r", "rows")).toEqual(
			extract(seen.stored, "rows"),
		);
		expect(seen.imaged).toEqual([[PARENT, CHILD]]);
		await expect(agents.read("earlier", "rows")).rejects.toThrow(
			"has run nothing yet",
		);
	});
});
