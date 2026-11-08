import type { MemoryRecord } from "@repo/memory-extension/ports";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { MAX_MEMORY_BYTES, MAX_WHEN_MEMORIES } from "../convex/limits.js";
import { ConvexMemoryStore, type MemoryClient } from "../src/memory-store.ts";
import { harness, signIn } from "./helpers.ts";

function row(key: string, body: string): MemoryRecord {
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

	it("caps the memories a judge is asked about, since each one is paid on every message", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const situational = (key: string): MemoryRecord => ({
			...row(key, '"note"'),
			on: `(when "${key}")`,
		});
		for (let i = 0; i < MAX_WHEN_MEMORIES; i++)
			await alice.as.mutation(api.memories.put, {
				workspaceId: alice.workspace,
				memory: situational(`a${i}`),
			});
		await expect(
			alice.as.mutation(api.memories.put, {
				workspaceId: alice.workspace,
				memory: situational("one-more"),
			}),
		).rejects.toThrow(/TOO_MANY_WHEN_MEMORIES/);
		await alice.as.mutation(api.memories.put, {
			workspaceId: alice.workspace,
			memory: { ...situational("a0"), score: 2 },
		});
		await alice.as.mutation(api.memories.put, {
			workspaceId: alice.workspace,
			memory: { ...row("plain", '"note"'), on: '(user "x")' },
		});
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

function spyClient(rows: MemoryRecord[]): {
	client: MemoryClient;
	calls: Call[];
} {
	const calls: Call[] = [];
	const answer = (reference: unknown, args: Record<string, unknown>) => {
		const name = named(reference);
		calls.push({ name, args });
		if (name === named(api.memories.list)) return Promise.resolve(rows);
		if (name === named(api.memories.get))
			return Promise.resolve(rows.find((r) => r.key === args.key) ?? null);
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

const WORKSPACE = "workspace-1" as Id<"workspaces">;

describe("the convex memory store", () => {
	it("re-reads the workspace on every listing, so a write from elsewhere shows up", async () => {
		const rows = [row("triage", '"logs"')];
		const { client, calls } = spyClient(rows);
		const store = new ConvexMemoryStore(WORKSPACE, () => client);

		expect(await store.all()).toHaveLength(1);
		expect((await store.get("triage"))?.body).toBe('"logs"');
		rows.push(row("billing", '"stripe"'));
		expect((await store.all()).map((memory) => memory.key)).toEqual([
			"triage",
			"billing",
		]);
		expect(listed(calls)).toHaveLength(2);
	});

	it("reads a memory from the workspace on every get, so an edit from elsewhere shows up", async () => {
		const rows = [row("triage", '"logs"')];
		const { client } = spyClient(rows);
		const store = new ConvexMemoryStore(WORKSPACE, () => client);

		expect((await store.get("triage"))?.body).toBe('"logs"');
		rows[0] = row("triage", '"traces"');
		expect((await store.get("triage"))?.body).toBe('"traces"');
		expect(await store.get("missing")).toBeUndefined();
	});

	it("writes through to convex", async () => {
		const { client, calls } = spyClient([]);
		const store = new ConvexMemoryStore(WORKSPACE, () => client);

		await store.put(row("triage", '"logs"'));
		expect(calls.at(-1)).toMatchObject({
			args: { workspaceId: WORKSPACE, memory: { key: "triage" } },
		});

		expect(await store.delete("triage")).toBe(true);
		expect(calls.at(-1)).toMatchObject({
			args: { workspaceId: WORKSPACE, key: "triage" },
		});
	});
});
