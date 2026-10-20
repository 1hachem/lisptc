import type { TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import { BIN_TTL_MS } from "../convex/limits.ts";
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
