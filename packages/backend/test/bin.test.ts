import { MAX_FILE_NAME } from "@repo/shared/files";
import type { TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import {
	BIN_TTL_MS,
	MAX_BIN,
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
	await alice.as.mutation(api.files.add, {
		folder: "knowledge",
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
	await alice.as.mutation(api.files.add, {
		folder: "attachments",
		workspaceId: alice.workspace,
		name,
		storageId: await stored(t, name),
	});
}

async function folders(alice: Alice) {
	const workspaceId = alice.workspace;
	return {
		knowledge: (
			await alice.as.query(api.files.list, { folder: "knowledge", workspaceId })
		).map((f) => f.name),
		attachments: (
			await alice.as.query(api.files.list, {
				folder: "attachments",
				workspaceId,
			})
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
		await alice.as.mutation(api.files.remove, {
			folder: "knowledge",
			workspaceId,
			name: "notes.md",
		});
		await alice.as.mutation(api.files.remove, {
			folder: "attachments",
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
		await alice.as.mutation(api.files.discard, {
			folder: "attachments",
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
		await alice.as.mutation(api.files.remove, {
			folder: "knowledge",
			workspaceId,
			name: "a.md",
		});
		await inKnowledge(t, alice, "a.md");
		await alice.as.mutation(api.files.remove, {
			folder: "knowledge",
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
		await alice.as.mutation(api.files.remove, {
			folder: "knowledge",
			workspaceId,
			name: "a.md",
		});
		await inKnowledge(t, alice, "a.md");
		await inAttachments(t, alice, "b.txt");
		await alice.as.mutation(api.files.remove, {
			folder: "attachments",
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

	it("numbers a name at the length cap without passing it, and restores it", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		const name = `${"a".repeat(MAX_FILE_NAME - 3)}.md`;
		for (let n = 0; n < 2; n++) {
			await inKnowledge(t, alice, name);
			await alice.as.mutation(api.files.remove, {
				folder: "knowledge",
				workspaceId,
				name,
			});
		}
		const binned = (await alice.as.query(api.bin.list, { workspaceId })).map(
			(f) => f.name,
		);
		const numbered = `${"a".repeat(MAX_FILE_NAME - 7)} (2).md`;
		expect(binned.sort()).toEqual([numbered, name].sort());
		expect(
			await alice.as.mutation(api.bin.restore, {
				workspaceId,
				name: numbered,
			}),
		).toEqual({ folder: "knowledge", name: numbered });
	});

	it("keeps the newest files once it holds as many as it may", async () => {
		vi.useFakeTimers();
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		const binnedAt = Date.now() - 60_000;
		await t.run(async (ctx) => {
			for (let n = 0; n < MAX_BIN; n++)
				await ctx.db.insert("bin", {
					workspaceId,
					name: `${n}.md`,
					from: "knowledge",
					storageId: await ctx.storage.store(new Blob([`${n}`])),
					size: 1,
					binnedAt: binnedAt + n,
				});
		});
		await inKnowledge(t, alice, "newest.md");
		await alice.as.mutation(api.files.remove, {
			folder: "knowledge",
			workspaceId,
			name: "newest.md",
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const bin = (await folders(alice)).bin;
		expect(bin).toHaveLength(MAX_BIN);
		expect(bin[0]).toBe("knowledge/newest.md");
		expect(bin).not.toContain("knowledge/0.md");
		expect(await blobs(t)).toHaveLength(MAX_BIN);
		vi.useRealTimers();
	});

	it("deletes a file for good", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await inKnowledge(t, alice, "a.md");
		await alice.as.mutation(api.files.remove, {
			folder: "knowledge",
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
			await alice.as.mutation(api.files.removeMany, {
				folder: "knowledge",
				workspaceId,
				names: ["a.md", "b.md", "a.md", "gone.md"],
			}),
		).toEqual(["a.md", "b.md"]);
		expect(
			await alice.as.mutation(api.files.removeMany, {
				folder: "attachments",
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
			alice.as.mutation(api.files.removeMany, {
				folder: "knowledge",
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

describe("an upload a file already claimed", () => {
	it("is refused for a second file and stays with the first", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		const storageId = await stored(t, "mine");
		await alice.as.mutation(api.files.add, {
			folder: "knowledge",
			workspaceId: alice.workspace,
			name: "mine.txt",
			storageId,
		});
		await expect(
			bob.as.mutation(api.files.add, {
				folder: "knowledge",
				workspaceId: bob.workspace,
				name: "stolen.txt",
				storageId,
			}),
		).rejects.toThrow("UPLOAD_CLAIMED");
		await expect(
			bob.as.mutation(api.files.add, {
				folder: "attachments",
				workspaceId: bob.workspace,
				name: "stolen.txt",
				storageId,
			}),
		).rejects.toThrow("UPLOAD_CLAIMED");
		await expect(
			alice.as.mutation(api.files.add, {
				folder: "attachments",
				workspaceId: alice.workspace,
				name: "again.txt",
				storageId,
			}),
		).rejects.toThrow("UPLOAD_CLAIMED");
		expect(await blobs(t)).toHaveLength(1);
		expect(
			await alice.as.query(api.files.get, {
				folder: "knowledge",
				workspaceId: alice.workspace,
				name: "mine.txt",
			}),
		).not.toBeNull();
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
		await alice.as.mutation(api.files.remove, {
			folder: "knowledge",
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
