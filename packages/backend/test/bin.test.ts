import type { TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import {
	BIN_TTL_MS,
	MAX_KNOWLEDGE,
	UNCLAIMED_UPLOAD_TTL_MS,
} from "../convex/limits.ts";
import type schema from "../convex/schema.ts";
import { harness, signIn } from "./helpers.ts";

type Alice = Awaited<ReturnType<typeof signIn>>;

function stored(t: TestConvex<typeof schema>, body: string) {
	return t.run((ctx) =>
		ctx.storage.store(new Blob([body], { type: "text/plain" })),
	);
}

async function inKnowledge(
	t: TestConvex<typeof schema>,
	alice: Alice,
	name: string,
) {
	await alice.as.mutation(api.knowledge.add, {
		workspaceId: alice.workspace,
		name,
		storageId: await stored(t, name),
	});
}

async function inAttachments(
	t: TestConvex<typeof schema>,
	alice: Alice,
	name: string,
) {
	await alice.as.mutation(api.attachments.add, {
		workspaceId: alice.workspace,
		name,
		storageId: await stored(t, name),
	});
}

async function folders(alice: Alice) {
	const workspaceId = alice.workspace;
	return {
		knowledge: (await alice.as.query(api.knowledge.list, { workspaceId })).map(
			(f) => f.name,
		),
		attachments: (
			await alice.as.query(api.attachments.list, { workspaceId })
		).map((f) => f.name),
		bin: (await alice.as.query(api.bin.list, { workspaceId })).map(
			(f) => `${f.from}/${f.name}`,
		),
	};
}

async function blobs(t: TestConvex<typeof schema>) {
	return await t.run((ctx) => ctx.db.system.query("_storage").collect());
}

describe("bin", () => {
	it("takes what knowledge and attachments delete, keeping the blob", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await inKnowledge(t, alice, "notes.md");
		await inAttachments(t, alice, "spec.pdf");
		await alice.as.mutation(api.knowledge.remove, {
			workspaceId,
			name: "notes.md",
		});
		await alice.as.mutation(api.attachments.remove, {
			workspaceId,
			name: "spec.pdf",
		});
		expect(await folders(alice)).toEqual({
			knowledge: [],
			attachments: [],
			bin: ["attachments/spec.pdf", "knowledge/notes.md"],
		});
		expect(
			await alice.as.query(api.bin.get, { workspaceId, name: "notes.md" }),
		).toMatchObject({ name: "notes.md", from: "knowledge" });
		expect(await blobs(t)).toHaveLength(2);
	});

	it("discards an attachment for good without the bin", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await inAttachments(t, alice, "spec.pdf");
		await alice.as.mutation(api.attachments.discard, {
			workspaceId: alice.workspace,
			name: "spec.pdf",
		});
		expect((await folders(alice)).bin).toEqual([]);
		expect(await blobs(t)).toHaveLength(0);
	});

	it("numbers a name the bin already holds", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await inKnowledge(t, alice, "a.md");
		await alice.as.mutation(api.knowledge.remove, {
			workspaceId,
			name: "a.md",
		});
		await inKnowledge(t, alice, "a.md");
		await alice.as.mutation(api.knowledge.remove, {
			workspaceId,
			name: "a.md",
		});
		expect((await folders(alice)).bin.sort()).toEqual([
			"knowledge/a (2).md",
			"knowledge/a.md",
		]);
	});

	it("restores a file to the folder it came from, numbering a taken name", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await inKnowledge(t, alice, "a.md");
		await alice.as.mutation(api.knowledge.remove, {
			workspaceId,
			name: "a.md",
		});
		await inKnowledge(t, alice, "a.md");
		await inAttachments(t, alice, "b.txt");
		await alice.as.mutation(api.attachments.remove, {
			workspaceId,
			name: "b.txt",
		});
		expect(
			await alice.as.mutation(api.bin.restore, { workspaceId, name: "a.md" }),
		).toEqual({ folder: "knowledge", name: "a (2).md" });
		expect(
			await alice.as.mutation(api.bin.restore, { workspaceId, name: "b.txt" }),
		).toEqual({ folder: "attachments", name: "b.txt" });
		expect(await folders(alice)).toEqual({
			knowledge: ["a (2).md", "a.md"],
			attachments: ["b.txt"],
			bin: [],
		});
		expect(
			await alice.as.mutation(api.bin.restore, { workspaceId, name: "a.md" }),
		).toEqual({ refused: "NO_SUCH_FILE" });
	});

	it("deletes a file for good", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await inKnowledge(t, alice, "a.md");
		await alice.as.mutation(api.knowledge.remove, {
			workspaceId,
			name: "a.md",
		});
		expect(
			await alice.as.mutation(api.bin.remove, { workspaceId, name: "a.md" }),
		).toBe(true);
		expect(
			await alice.as.mutation(api.bin.remove, { workspaceId, name: "a.md" }),
		).toBe(false);
		expect((await folders(alice)).bin).toEqual([]);
		expect(await blobs(t)).toHaveLength(0);
	});

	it("bins many files in one call and deletes them for good in another", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await inKnowledge(t, alice, "a.md");
		await inKnowledge(t, alice, "b.md");
		await inKnowledge(t, alice, "kept.md");
		await inAttachments(t, alice, "c.txt");
		expect(
			await alice.as.mutation(api.knowledge.removeMany, {
				workspaceId,
				names: ["a.md", "b.md", "a.md", "gone.md"],
			}),
		).toEqual(["a.md", "b.md"]);
		expect(
			await alice.as.mutation(api.attachments.removeMany, {
				workspaceId,
				names: ["c.txt"],
			}),
		).toEqual(["c.txt"]);
		expect(await folders(alice)).toEqual({
			knowledge: ["kept.md"],
			attachments: [],
			bin: ["attachments/c.txt", "knowledge/b.md", "knowledge/a.md"],
		});
		expect(
			await alice.as.mutation(api.bin.removeMany, {
				workspaceId,
				names: ["a.md", "c.txt"],
			}),
		).toEqual(["a.md", "c.txt"]);
		expect((await folders(alice)).bin).toEqual(["knowledge/b.md"]);
		expect(await blobs(t)).toHaveLength(2);
	});

	it("refuses more names in one call than a folder can hold", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.knowledge.removeMany, {
				workspaceId: alice.workspace,
				names: Array.from({ length: MAX_KNOWLEDGE + 1 }, (_, n) => `${n}.md`),
			}),
		).rejects.toThrow("TOO_MANY_FILES");
	});

	it("empties a file left in the bin past its month, and only that one", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		for (const [name, binnedAt] of [
			["fresh.md", Date.now()],
			["stale.md", Date.now() - BIN_TTL_MS - 1],
		] as const) {
			const storageId = await stored(t, name);
			await t.run((ctx) =>
				ctx.db.insert("bin", {
					workspaceId,
					name,
					from: "knowledge",
					storageId,
					size: name.length,
					binnedAt,
				}),
			);
		}
		await t.mutation(internal.bin.empty, {});
		expect((await folders(alice)).bin).toEqual(["knowledge/fresh.md"]);
		expect(await blobs(t)).toHaveLength(1);
	});
});

describe("an upload no file claimed", () => {
	afterEach(() => vi.useRealTimers());

	it("is freed a day on, while every claimed blob stays", async () => {
		vi.useFakeTimers();
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		const unclaimed = await stored(t, "lost");
		await inKnowledge(t, alice, "kept.txt");
		await inAttachments(t, alice, "attached.txt");
		await inKnowledge(t, alice, "binned.txt");
		await alice.as.mutation(api.knowledge.remove, {
			workspaceId,
			name: "binned.txt",
		});
		vi.setSystemTime(Date.now() + UNCLAIMED_UPLOAD_TTL_MS + 1);
		const fresh = await stored(t, "in flight");
		const before = (await blobs(t)).map((blob) => blob._id);
		await t.mutation(internal.uploads.sweep, {});
		const after = (await blobs(t)).map((blob) => blob._id);
		expect(after).toHaveLength(before.length - 1);
		expect(after).not.toContain(unclaimed);
		expect(after).toContain(fresh);
		const held = await t.run(async (ctx) => [
			...(await ctx.db.query("knowledge").collect()),
			...(await ctx.db.query("attachments").collect()),
			...(await ctx.db.query("bin").collect()),
		]);
		expect(held.map((row) => row.name).sort()).toEqual([
			"attached.txt",
			"binned.txt",
			"kept.txt",
		]);
		for (const row of held) expect(after).toContain(row.storageId);
	});
});
