import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { MAX_MEMORY_BYTES } from "../convex/limits.js";
import {
	ConvexMemoryStore,
	type MemoryClient,
	type StoredMemory,
} from "../src/memory-store.ts";
import { harness, signIn } from "./helpers.ts";

function row(key: string, body: string): StoredMemory {
	return { key, body, links: [], score: 1, used: 0, lastUsed: 0 };
}

describe("memory access", () => {
	it("keeps a memory in the workspace it was written to", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await alice.as.mutation(api.memories.put, {
			workspaceId: alice.workspace,
			memory: row("triage", '"start with the logs"'),
		});

		expect(
			await alice.as.query(api.memories.list, {
				workspaceId: alice.workspace,
			}),
		).toHaveLength(1);
		expect(
			await bob.as.query(api.memories.list, { workspaceId: bob.workspace }),
		).toEqual([]);
	});

	it("refuses another user's workspace", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await expect(
			alice.as.query(api.memories.list, { workspaceId: bob.workspace }),
		).rejects.toThrow();
		await expect(
			alice.as.mutation(api.memories.put, {
				workspaceId: bob.workspace,
				memory: row("theirs", '"not mine to write"'),
			}),
		).rejects.toThrow();
	});

	it("refuses an unauthenticated caller", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			t.query(api.memories.list, { workspaceId: alice.workspace }),
		).rejects.toThrow();
	});

	it("replaces a memory written under a key it already holds", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		for (const body of ['"first"', '"second"'])
			await alice.as.mutation(api.memories.put, {
				workspaceId: alice.workspace,
				memory: { ...row("triage", body), used: 3 },
			});

		const listed = await alice.as.query(api.memories.list, {
			workspaceId: alice.workspace,
		});
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({ body: '"second"', used: 3 });
	});

	it("reports whether forgetting one found anything", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await alice.as.mutation(api.memories.put, {
			workspaceId: alice.workspace,
			memory: row("triage", '"start with the logs"'),
		});

		expect(
			await alice.as.mutation(api.memories.remove, {
				workspaceId: alice.workspace,
				key: "triage",
			}),
		).toBe(true);
		expect(
			await alice.as.mutation(api.memories.remove, {
				workspaceId: alice.workspace,
				key: "triage",
			}),
		).toBe(false);
	});

	it("refuses a memory larger than the cap", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.memories.put, {
				workspaceId: alice.workspace,
				memory: row("huge", "x".repeat(MAX_MEMORY_BYTES + 1)),
			}),
		).rejects.toThrow();
	});
});

describe("removing a workspace", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("takes its memories with it", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await alice.as.mutation(api.memories.put, {
			workspaceId: alice.workspace,
			memory: row("triage", '"start with the logs"'),
		});

		await alice.as.mutation(api.workspaces.remove, {
			workspaceId: alice.workspace,
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(
			await t.run(async (ctx) => await ctx.db.query("memories").collect()),
		).toEqual([]);
	});
});

interface Call {
	name: string;
	args: Record<string, unknown>;
}

function named(reference: unknown): string {
	return getFunctionName(reference as FunctionReference<"query" | "mutation">);
}

function spyClient(rows: StoredMemory[]): {
	client: MemoryClient;
	calls: Call[];
} {
	const calls: Call[] = [];
	const answer = (reference: unknown, args: Record<string, unknown>) => {
		const name = named(reference);
		calls.push({ name, args });
		if (name === named(api.memories.list)) return Promise.resolve(rows);
		if (name === named(api.memories.remove)) return Promise.resolve(true);
		return Promise.resolve(null);
	};
	return {
		calls,
		client: {
			query: answer,
			mutation: answer,
		} as unknown as MemoryClient,
	};
}

function listed(calls: Call[]): Call[] {
	return calls.filter((call) => call.name === named(api.memories.list));
}

const passthrough = {
	encode: (memory: StoredMemory) => memory,
	decode: (row: StoredMemory) => row,
};

const WORKSPACE = "workspace-1" as Id<"workspaces">;

describe("the convex memory store", () => {
	it("reads the workspace once and answers from the cache after", async () => {
		const { client, calls } = spyClient([row("triage", '"logs"')]);
		const store = new ConvexMemoryStore(WORKSPACE, () => client, passthrough);

		expect(await store.all()).toHaveLength(1);
		expect((await store.get("triage"))?.body).toBe('"logs"');
		expect(store.all()).toEqual([expect.objectContaining({ key: "triage" })]);
		expect(listed(calls)).toHaveLength(1);
	});

	it("serves a hydrated read without awaiting", async () => {
		const { client } = spyClient([row("triage", '"logs"')]);
		const store = new ConvexMemoryStore(WORKSPACE, () => client, passthrough);
		await store.all();

		expect(store.get("triage")).not.toBeInstanceOf(Promise);
	});

	it("writes through to convex and to the cache", async () => {
		const { client, calls } = spyClient([]);
		const store = new ConvexMemoryStore(WORKSPACE, () => client, passthrough);

		await store.put(row("triage", '"logs"'));
		expect(store.get("triage")).toMatchObject({ key: "triage" });
		expect(calls.at(-1)).toMatchObject({
			args: { workspaceId: WORKSPACE, memory: { key: "triage" } },
		});

		expect(await store.delete("triage")).toBe(true);
		expect(store.get("triage")).toBeUndefined();
		expect(calls.at(-1)).toMatchObject({
			args: { workspaceId: WORKSPACE, key: "triage" },
		});
	});

	it("hydrates once when several reads race", async () => {
		const { client, calls } = spyClient([row("triage", '"logs"')]);
		const store = new ConvexMemoryStore(WORKSPACE, () => client, passthrough);

		await Promise.all([store.all(), store.all(), store.get("triage")]);

		expect(listed(calls)).toHaveLength(1);
	});
});
