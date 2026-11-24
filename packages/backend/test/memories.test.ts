import type { MemoryRecord } from "@repo/memory-extension/ports";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api.js";
import { MAX_MEMORY_BYTES, MAX_WHEN_MEMORIES } from "../convex/limits.js";
import { ConvexMemoryStore, type MemoryClient } from "../src/memory-store.ts";
import { signIn, testDeployment } from "./helpers.ts";

function row(key: string, body: string): MemoryRecord {
	return { key, body, links: [], score: 1, used: 0, lastUsed: 0 };
}

describe("memory access", () => {
	it("keeps a memory in the workspace it was written to", async () => {
		const t = testDeployment();
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
		const t = testDeployment();
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
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			t.query(api.memories.list, { workspaceId: alice.workspace }),
		).rejects.toThrow();
	});

	it("replaces a memory written under a key it already holds", async () => {
		const t = testDeployment();
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
		const t = testDeployment();
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

	it("clears every memory of a workspace and no other", async () => {
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		for (const key of ["triage", "billing"])
			await alice.as.mutation(api.memories.put, {
				workspaceId: alice.workspace,
				memory: row(key, '"kept"'),
			});
		await bob.as.mutation(api.memories.put, {
			workspaceId: bob.workspace,
			memory: row("triage", '"theirs"'),
		});

		expect(
			await alice.as.mutation(api.memories.clear, {
				workspaceId: alice.workspace,
			}),
		).toBe(2);
		expect(
			await alice.as.query(api.memories.list, {
				workspaceId: alice.workspace,
			}),
		).toEqual([]);
		expect(
			await bob.as.query(api.memories.list, { workspaceId: bob.workspace }),
		).toHaveLength(1);
		await expect(
			alice.as.mutation(api.memories.clear, { workspaceId: bob.workspace }),
		).rejects.toThrow();
	});

	it("refuses a memory larger than the cap", async () => {
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.memories.put, {
				workspaceId: alice.workspace,
				memory: row("huge", "x".repeat(MAX_MEMORY_BYTES + 1)),
			}),
		).rejects.toThrow();
	});

	it("caps the memories a judge is asked about, since each one is paid on every message", async () => {
		const t = testDeployment();
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
		const t = testDeployment();
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

async function workspace() {
	const alice = await signIn(testDeployment(), "alice@example.com");
	return {
		workspace: alice.workspace,
		connect: () => alice.as as unknown as MemoryClient,
	};
}

const write = (record: MemoryRecord) => ({ record, source: "" });

describe("the convex memory store", () => {
	it("writes through to convex, so a fresh store reads what another wrote", async () => {
		const { workspace: id, connect } = await workspace();
		const writer = new ConvexMemoryStore(id, connect);

		await writer.put(write(row("triage", '"logs"')));
		expect((await new ConvexMemoryStore(id, connect).get("triage"))?.body).toBe(
			'"logs"',
		);

		expect(await writer.delete("triage")).toBe(true);
		expect(
			await new ConvexMemoryStore(id, connect).get("triage"),
		).toBeUndefined();
	});

	it("hands a fresh store back the trigger, links and strength another wrote", async () => {
		const { workspace: id, connect } = await workspace();
		const record: MemoryRecord = {
			key: "triage",
			body: '"start with the logs"',
			on: '(error "timeout")',
			links: [{ key: "logs", weight: 2 }],
			score: 1.5,
			used: 3,
			lastUsed: 1_700_000_000_000,
		};
		await new ConvexMemoryStore(id, connect).put(write(record));

		expect(await new ConvexMemoryStore(id, connect).get("triage")).toEqual(
			record,
		);
	});

	it("shows a write from elsewhere on the next listing and the next get", async () => {
		const { workspace: id, connect } = await workspace();
		const reader = new ConvexMemoryStore(id, connect);
		const elsewhere = new ConvexMemoryStore(id, connect);
		await elsewhere.put(write(row("triage", '"logs"')));
		expect(await reader.all()).toHaveLength(1);

		await elsewhere.put(write(row("billing", '"stripe"')));
		await elsewhere.put(write(row("triage", '"traces"')));

		expect((await reader.all()).map((memory) => memory.key).sort()).toEqual([
			"billing",
			"triage",
		]);
		expect((await reader.get("triage"))?.body).toBe('"traces"');
	});
});
