import type { TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import { ATTACHMENT_TTL_MS, MAX_KNOWLEDGE_BYTES } from "../convex/limits.ts";
import type schema from "../convex/schema.ts";
import { signIn, testDeployment } from "./helpers.ts";

function uploaded(t: TestConvex<typeof schema>, body: BlobPart, type: string) {
	return t.run((ctx) => ctx.storage.store(new Blob([body], { type })));
}

async function blobs(t: TestConvex<typeof schema>) {
	return await t.run((ctx) => ctx.db.system.query("_storage").collect());
}

function earlier(ms: number) {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(Date.now() - ms);
}

afterEach(() => {
	vi.useRealTimers();
});

describe("attachments", () => {
	it("holds an attached file apart from knowledge, and serves it", async () => {
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		expect(
			await alice.as.mutation(api.files.add, {
				folder: "attachments",
				workspaceId,
				name: "spec.pdf",
				storageId: await uploaded(t, "%PDF-1.7", "application/pdf"),
				contentType: "application/pdf",
			}),
		).toEqual({ name: "spec.pdf" });
		expect(
			await alice.as.query(api.files.list, {
				folder: "attachments",
				workspaceId,
			}),
		).toMatchObject([
			{ name: "spec.pdf", contentType: "application/pdf", size: 8 },
		]);
		expect(
			await alice.as.query(api.files.list, {
				folder: "knowledge",
				workspaceId,
			}),
		).toEqual([]);
		const served = await alice.as.query(api.files.get, {
			folder: "attachments",
			workspaceId,
			name: "spec.pdf",
		});
		expect(served?.url).toEqual(expect.any(String));
	});

	it("numbers a name attachments already hold instead of replacing it", async () => {
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		const add = async () =>
			await alice.as.mutation(api.files.add, {
				folder: "attachments",
				workspaceId,
				name: "image.png",
				storageId: await uploaded(t, "png", "image/png"),
			});
		expect(await add()).toEqual({ name: "image.png" });
		expect(await add()).toEqual({ name: "image (2).png" });
		expect(await blobs(t)).toHaveLength(2);
	});

	it("refuses a file too large or badly named, and drops its blob", async () => {
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		expect(
			await alice.as.mutation(api.files.add, {
				folder: "attachments",
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
			await alice.as.mutation(api.files.add, {
				folder: "attachments",
				workspaceId,
				name: "../x",
				storageId: await uploaded(t, "x", "text/plain"),
			}),
		).toEqual({ refused: "BAD_KNOWLEDGE_NAME" });
		expect(await blobs(t)).toEqual([]);
	});

	it("keeps a file by moving it into knowledge with the same blob", async () => {
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.files.add, {
			folder: "attachments",
			workspaceId,
			name: "notes.md",
			storageId: await uploaded(t, "# notes", "text/markdown"),
			contentType: "text/markdown",
		});
		expect(
			await alice.as.mutation(api.files.keep, {
				workspaceId,
				name: "notes.md",
			}),
		).toBeNull();
		expect(
			await alice.as.query(api.files.list, {
				folder: "attachments",
				workspaceId,
			}),
		).toEqual([]);
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
		]);
		expect(await blobs(t)).toHaveLength(1);
		expect(
			await alice.as.mutation(api.files.keep, {
				workspaceId,
				name: "notes.md",
			}),
		).toBe("NO_SUCH_FILE");
	});

	it("unkeeps a knowledge file back into attachments with the same blob", async () => {
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.files.add, {
			folder: "knowledge",
			workspaceId,
			name: "notes.md",
			storageId: await uploaded(t, "# notes", "text/markdown"),
			contentType: "text/markdown",
		});
		expect(
			await alice.as.mutation(api.files.unkeep, {
				workspaceId,
				name: "notes.md",
			}),
		).toBeNull();
		expect(
			await alice.as.query(api.files.list, {
				folder: "knowledge",
				workspaceId,
			}),
		).toEqual([]);
		expect(
			(
				await alice.as.query(api.files.list, {
					folder: "attachments",
					workspaceId,
				})
			).map((file) => file.name),
		).toEqual(["notes.md"]);
		expect(await blobs(t)).toHaveLength(1);
		expect(
			await alice.as.mutation(api.files.unkeep, {
				workspaceId,
				name: "notes.md",
			}),
		).toBe("NO_SUCH_FILE");
	});

	it("refuses to keep over a knowledge file of the same name", async () => {
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.files.add, {
			folder: "knowledge",
			workspaceId,
			name: "a.md",
			storageId: await uploaded(t, "kept", "text/markdown"),
		});
		await alice.as.mutation(api.files.add, {
			folder: "attachments",
			workspaceId,
			name: "a.md",
			storageId: await uploaded(t, "new", "text/markdown"),
		});
		expect(
			await alice.as.mutation(api.files.keep, {
				workspaceId,
				name: "a.md",
			}),
		).toBe("NAME_TAKEN");
	});

	it("moves a file left in attachments past its time to the bin, and only that one", async () => {
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		earlier(ATTACHMENT_TTL_MS + 1);
		await alice.as.mutation(api.files.add, {
			folder: "attachments",
			workspaceId,
			name: "old.txt",
			storageId: await uploaded(t, "old", "text/plain"),
		});
		vi.useRealTimers();
		await alice.as.mutation(api.files.add, {
			folder: "attachments",
			workspaceId,
			name: "new.txt",
			storageId: await uploaded(t, "new", "text/plain"),
		});
		await t.mutation(internal.files.expire, {});
		expect(
			(
				await alice.as.query(api.files.list, {
					folder: "attachments",
					workspaceId,
				})
			).map((f) => f.name),
		).toEqual(["new.txt"]);
		expect(
			(await alice.as.query(api.bin.list, { workspaceId })).map((f) => f.name),
		).toEqual(["old.txt"]);
	});

	it("keeps expiring when the bin holds every numbered copy of a name", async () => {
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		for (let copy = 0; copy <= 100; copy++)
			await alice.as.mutation(api.files.add, {
				folder: "knowledge",
				workspaceId,
				name: "old.txt",
				storageId: await uploaded(t, `copy ${copy}`, "text/plain"),
			});
		const before = (await alice.as.query(api.bin.list, { workspaceId })).length;
		earlier(ATTACHMENT_TTL_MS + 1);
		await alice.as.mutation(api.files.add, {
			folder: "attachments",
			workspaceId,
			name: "old.txt",
			storageId: await uploaded(t, "old", "text/plain"),
		});
		vi.useRealTimers();
		await t.mutation(internal.files.expire, {});
		expect(
			await alice.as.query(api.files.list, {
				folder: "attachments",
				workspaceId,
			}),
		).toEqual([]);
		const binned = (await alice.as.query(api.bin.list, { workspaceId })).map(
			(f) => f.name,
		);
		expect(binned).toHaveLength(before + 1);
		expect(new Set(binned).size).toBe(binned.length);
	});
});
