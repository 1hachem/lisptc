import type { TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import { MAX_KNOWLEDGE, MAX_KNOWLEDGE_BYTES } from "../convex/limits.ts";
import type schema from "../convex/schema.ts";
import { harness, signIn } from "./helpers.ts";

function uploaded(t: TestConvex<typeof schema>, body: BlobPart, type: string) {
	return t.run((ctx) => ctx.storage.store(new Blob([body], { type })));
}

async function blobs(t: TestConvex<typeof schema>) {
	return await t.run((ctx) => ctx.db.system.query("_storage").collect());
}

describe("knowledge", () => {
	it("adds, lists, serves and removes an uploaded file", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.files.add, {
			folder: "knowledge",
			workspaceId,
			name: "spec.pdf",
			storageId: await uploaded(t, "%PDF-1.7", "application/pdf"),
			contentType: "application/pdf",
		});
		await alice.as.mutation(api.files.add, {
			folder: "knowledge",
			workspaceId,
			name: "notes.md",
			storageId: await uploaded(t, "# notes", "text/markdown"),
			contentType: "text/markdown",
		});
		expect(
			await alice.as.query(api.files.list, {
				folder: "knowledge",
				workspaceId,
			}),
		).toEqual([
			{
				name: "notes.md",
				contentType: "text/markdown",
				size: 7,
				addedAt: expect.any(Number),
			},
			{
				name: "spec.pdf",
				contentType: "application/pdf",
				size: 8,
				addedAt: expect.any(Number),
			},
		]);
		const served = await alice.as.query(api.files.get, {
			folder: "knowledge",
			workspaceId,
			name: "spec.pdf",
		});
		expect(served).toMatchObject({ name: "spec.pdf", size: 8 });
		expect(served?.url).toEqual(expect.any(String));
		expect(
			await alice.as.mutation(api.files.remove, {
				folder: "knowledge",
				workspaceId,
				name: "spec.pdf",
			}),
		).toBe(true);
		expect(
			await alice.as.query(api.files.get, {
				folder: "knowledge",
				workspaceId,
				name: "spec.pdf",
			}),
		).toBeNull();
		expect(
			(await alice.as.query(api.bin.list, { workspaceId })).map(
				({ name, from }) => [name, from],
			),
		).toEqual([["spec.pdf", "knowledge"]]);
		expect(await blobs(t)).toHaveLength(2);
	});

	it("replaces a file of the same name and bins the old one", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		for (const body of ["one", "three"])
			await alice.as.mutation(api.files.add, {
				folder: "knowledge",
				workspaceId,
				name: "notes.txt",
				storageId: await uploaded(t, body, "text/plain"),
				contentType: "text/plain",
			});
		expect(
			await alice.as.query(api.files.list, {
				folder: "knowledge",
				workspaceId,
			}),
		).toEqual([
			{
				name: "notes.txt",
				contentType: "text/plain",
				size: 5,
				addedAt: expect.any(Number),
			},
		]);
		expect(
			(await alice.as.query(api.bin.list, { workspaceId })).map(
				({ name, from, size }) => [name, from, size],
			),
		).toEqual([["notes.txt", "knowledge", 3]]);
		expect(await blobs(t)).toHaveLength(2);
	});

	it("refuses another user's workspace", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await expect(
			alice.as.mutation(api.files.uploadUrl, {
				workspaceId: bob.workspace,
			}),
		).rejects.toThrow(/FORBIDDEN/);
		await expect(
			alice.as.mutation(api.files.add, {
				folder: "knowledge",
				workspaceId: bob.workspace,
				name: "x.txt",
				storageId: await uploaded(t, "x", "text/plain"),
			}),
		).rejects.toThrow(/FORBIDDEN/);
		await expect(
			alice.as.query(api.files.list, {
				folder: "knowledge",
				workspaceId: bob.workspace,
			}),
		).rejects.toThrow(/FORBIDDEN/);
	});

	it.each([
		"",
		"../escape.txt",
		"a/b.txt",
		".hidden",
		" padded.txt",
	])("refuses the name %j and drops its blob", async (name) => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.files.add, {
				folder: "knowledge",
				workspaceId: alice.workspace,
				name,
				storageId: await uploaded(t, "x", "text/plain"),
			}),
		).resolves.toEqual({ refused: "BAD_KNOWLEDGE_NAME" });
		expect(await blobs(t)).toEqual([]);
	});

	it("refuses a file over the size limit and drops its blob", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.files.add, {
				folder: "knowledge",
				workspaceId: alice.workspace,
				name: "big.bin",
				storageId: await uploaded(
					t,
					new Uint8Array(MAX_KNOWLEDGE_BYTES + 1),
					"application/octet-stream",
				),
			}),
		).resolves.toEqual({ refused: "FILE_TOO_LARGE" });
		expect(await blobs(t)).toEqual([]);
	});

	it("refuses a new file past the count limit", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		const storageId = await uploaded(t, "x", "text/plain");
		await t.run(async (ctx) => {
			for (let i = 0; i < MAX_KNOWLEDGE; i++)
				await ctx.db.insert("knowledge", {
					workspaceId,
					name: `f${i}.txt`,
					storageId,
					size: 1,
				});
		});
		await expect(
			alice.as.mutation(api.files.add, {
				folder: "knowledge",
				workspaceId,
				name: "one-more.txt",
				storageId: await uploaded(t, "y", "text/plain"),
			}),
		).resolves.toEqual({ refused: "TOO_MANY_FILES" });
	});
});
