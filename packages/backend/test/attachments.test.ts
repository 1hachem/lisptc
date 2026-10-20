import type { TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import { ATTACHMENT_TTL_MS, MAX_KNOWLEDGE_BYTES } from "../convex/limits.ts";
import type schema from "../convex/schema.ts";
import { harness, signIn } from "./helpers.ts";

function uploaded(t: TestConvex<typeof schema>, body: BlobPart, type: string) {
	return t.run((ctx) => ctx.storage.store(new Blob([body], { type })));
}

async function blobs(t: TestConvex<typeof schema>) {
	return await t.run((ctx) => ctx.db.system.query("_storage").collect());
}

describe("attachments", () => {
	it("holds an attached file apart from knowledge, and serves it", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		expect(
			await alice.as.mutation(api.attachments.add, {
				workspaceId,
				name: "spec.pdf",
				storageId: await uploaded(t, "%PDF-1.7", "application/pdf"),
				contentType: "application/pdf",
			}),
		).toEqual({ name: "spec.pdf" });
		expect(
			await alice.as.query(api.attachments.list, { workspaceId }),
		).toMatchObject([
			{ name: "spec.pdf", contentType: "application/pdf", size: 8 },
		]);
		expect(await alice.as.query(api.knowledge.list, { workspaceId })).toEqual(
			[],
		);
		const served = await alice.as.query(api.attachments.get, {
			workspaceId,
			name: "spec.pdf",
		});
		expect(served?.url).toEqual(expect.any(String));
	});

	it("numbers a name attachments already hold instead of replacing it", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		const add = async () =>
			await alice.as.mutation(api.attachments.add, {
				workspaceId,
				name: "image.png",
				storageId: await uploaded(t, "png", "image/png"),
			});
		expect(await add()).toEqual({ name: "image.png" });
		expect(await add()).toEqual({ name: "image (2).png" });
		expect(await blobs(t)).toHaveLength(2);
	});

	it("refuses a file too large or badly named, and drops its blob", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		expect(
			await alice.as.mutation(api.attachments.add, {
				workspaceId,
				name: "big.bin",
				storageId: await uploaded(
					t,
					new Uint8Array(MAX_KNOWLEDGE_BYTES + 1),
					"application/octet-stream",
				),
			}),
		).toEqual({ refused: "FILE_TOO_LARGE" });
		expect(
			await alice.as.mutation(api.attachments.add, {
				workspaceId,
				name: "../x",
				storageId: await uploaded(t, "x", "text/plain"),
			}),
		).toEqual({ refused: "BAD_KNOWLEDGE_NAME" });
		expect(await blobs(t)).toEqual([]);
	});

	it("keeps a file by moving it into knowledge with the same blob", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.attachments.add, {
			workspaceId,
			name: "notes.md",
			storageId: await uploaded(t, "# notes", "text/markdown"),
			contentType: "text/markdown",
		});
		expect(
			await alice.as.mutation(api.attachments.keep, {
				workspaceId,
				name: "notes.md",
			}),
		).toBeNull();
		expect(await alice.as.query(api.attachments.list, { workspaceId })).toEqual(
			[],
		);
		expect(await alice.as.query(api.knowledge.list, { workspaceId })).toEqual([
			{ name: "notes.md", contentType: "text/markdown", size: 7 },
		]);
		expect(await blobs(t)).toHaveLength(1);
		expect(
			await alice.as.mutation(api.attachments.keep, {
				workspaceId,
				name: "notes.md",
			}),
		).toBe("NO_SUCH_FILE");
	});

	it("refuses to keep over a knowledge file of the same name", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.knowledge.add, {
			workspaceId,
			name: "a.md",
			storageId: await uploaded(t, "kept", "text/markdown"),
		});
		await alice.as.mutation(api.attachments.add, {
			workspaceId,
			name: "a.md",
			storageId: await uploaded(t, "new", "text/markdown"),
		});
		expect(
			await alice.as.mutation(api.attachments.keep, {
				workspaceId,
				name: "a.md",
			}),
		).toBe("NAME_TAKEN");
	});

	it("expires a file left in attachments past its time, and only that one", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.attachments.add, {
			workspaceId,
			name: "new.txt",
			storageId: await uploaded(t, "new", "text/plain"),
		});
		const old = await uploaded(t, "old", "text/plain");
		await t.run((ctx) =>
			ctx.db.insert("attachments", {
				workspaceId,
				name: "old.txt",
				storageId: old,
				size: 3,
				attachedAt: Date.now() - ATTACHMENT_TTL_MS - 1,
			}),
		);
		await t.mutation(internal.attachments.expire, {});
		expect(
			(await alice.as.query(api.attachments.list, { workspaceId })).map(
				(f) => f.name,
			),
		).toEqual(["new.txt"]);
		expect(await blobs(t)).toHaveLength(1);
	});
});
