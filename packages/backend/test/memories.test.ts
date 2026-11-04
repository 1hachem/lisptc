import type { Memory } from "@repo/memory-extension/ports";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api.js";
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

async function seeded(...rows: StoredMemory[]) {
	const alice = await signIn(harness(), "alice@example.com");
	for (const memory of rows)
		await alice.as.mutation(api.memories.put, {
			workspaceId: alice.workspace,
			memory,
		});
	return {
		workspace: alice.workspace,
		connect: () => alice.as as unknown as MemoryClient,
	};
}

function remembered(key: string, body: unknown): Memory {
	return { key, body, links: new Map(), score: 1, used: 0, lastUsed: 0 };
}

describe("the convex memory store", () => {
	it("answers from the cache once it has read the workspace", async () => {
		const { workspace, connect } = await seeded(row("triage", '"logs"'));
		const store = new ConvexMemoryStore(workspace, connect);

		expect(await store.all()).toHaveLength(1);
		expect((await store.get("triage"))?.body).toBe("logs");
		expect(store.all()).toEqual([expect.objectContaining({ key: "triage" })]);
	});

	it("serves a hydrated read without awaiting", async () => {
		const { workspace, connect } = await seeded(row("triage", '"logs"'));
		const store = new ConvexMemoryStore(workspace, connect);
		await store.all();

		expect(store.get("triage")).not.toBeInstanceOf(Promise);
	});

	it("writes through to convex, so a fresh store reads what another wrote", async () => {
		const { workspace, connect } = await seeded();
		const writer = new ConvexMemoryStore(workspace, connect);

		await writer.put(remembered("triage", "logs"));
		expect(writer.get("triage")).toMatchObject({ key: "triage" });
		expect(
			(await new ConvexMemoryStore(workspace, connect).get("triage"))?.body,
		).toBe("logs");

		expect(await writer.delete("triage")).toBe(true);
		expect(writer.get("triage")).toBeUndefined();
		expect(
			await new ConvexMemoryStore(workspace, connect).get("triage"),
		).toBeUndefined();
	});
});
