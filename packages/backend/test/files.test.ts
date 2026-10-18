import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import { MAX_FILE_BYTES, MAX_FILES } from "../convex/limits.ts";
import { harness, signIn } from "./helpers.ts";

describe("workspace files", () => {
	it("writes, replaces, lists and removes a file", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.files.put, {
			workspaceId,
			path: "notes.ptc",
			source: "(:a 1)\n",
		});
		await alice.as.mutation(api.files.put, {
			workspaceId,
			path: "landing-page.ptc",
			source: "(:a 2)\n",
		});
		await alice.as.mutation(api.files.put, {
			workspaceId,
			path: "notes.ptc",
			source: "(:a 3)\n",
		});
		expect(await alice.as.query(api.files.list, { workspaceId })).toEqual([
			"landing-page.ptc",
			"notes.ptc",
		]);
		expect(
			await alice.as.query(api.files.get, { workspaceId, path: "notes.ptc" }),
		).toBe("(:a 3)\n");
		expect(
			await alice.as.mutation(api.files.remove, {
				workspaceId,
				path: "notes.ptc",
			}),
		).toBe(true);
		expect(
			await alice.as.query(api.files.get, { workspaceId, path: "notes.ptc" }),
		).toBeNull();
		expect(
			await alice.as.mutation(api.files.remove, {
				workspaceId,
				path: "notes.ptc",
			}),
		).toBe(false);
	});

	it("refuses another user's workspace", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await expect(
			alice.as.mutation(api.files.put, {
				workspaceId: bob.workspace,
				path: "notes.ptc",
				source: "1\n",
			}),
		).rejects.toThrow(/FORBIDDEN/);
		await expect(
			alice.as.query(api.files.list, { workspaceId: bob.workspace }),
		).rejects.toThrow(/FORBIDDEN/);
	});

	it("refuses a path outside the rule", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.files.put, {
				workspaceId: alice.workspace,
				path: "../escape.ptc",
				source: "1\n",
			}),
		).rejects.toThrow(/BAD_FILE_PATH/);
	});

	it("refuses a file over the size limit", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.files.put, {
				workspaceId: alice.workspace,
				path: "big.ptc",
				source: "x".repeat(MAX_FILE_BYTES + 1),
			}),
		).rejects.toThrow(/FILE_TOO_LARGE/);
	});

	it("refuses a new file past the count limit, and still replaces one", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await t.run(async (ctx) => {
			for (let i = 0; i < MAX_FILES; i++)
				await ctx.db.insert("files", {
					workspaceId,
					path: `f${i}.ptc`,
					source: "1\n",
				});
		});
		await expect(
			alice.as.mutation(api.files.put, {
				workspaceId,
				path: "one-more.ptc",
				source: "1\n",
			}),
		).rejects.toThrow(/TOO_MANY_FILES/);
		await alice.as.mutation(api.files.put, {
			workspaceId,
			path: "f0.ptc",
			source: "2\n",
		});
		expect(
			await alice.as.query(api.files.get, { workspaceId, path: "f0.ptc" }),
		).toBe("2\n");
	});
});
