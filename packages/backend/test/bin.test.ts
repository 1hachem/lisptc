import type { TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { BIN_TTL_MS } from "../convex/limits.ts";
import type schema from "../convex/schema.ts";
import { harness, signIn } from "./helpers.ts";

async function attached(
	t: TestConvex<typeof schema>,
	workspaceId: Id<"workspaces">,
	name: string,
	binnedAt?: number,
) {
	const storageId = await t.run((ctx) =>
		ctx.storage.store(new Blob([name], { type: "text/plain" })),
	);
	await t.run((ctx) =>
		ctx.db.insert("attachments", {
			workspaceId,
			name,
			storageId,
			size: name.length,
			attachedAt: Date.now(),
			binnedAt,
		}),
	);
}

async function names(alice: Awaited<ReturnType<typeof signIn>>) {
	const workspaceId = alice.workspace;
	return {
		attachments: (
			await alice.as.query(api.attachments.list, { workspaceId })
		).map((f) => f.name),
		bin: (await alice.as.query(api.bin.list, { workspaceId })).map(
			(f) => f.name,
		),
	};
}

describe("bin", () => {
	it("takes a file out of attachments, out of the agent's reach", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await attached(t, workspaceId, "a.md");
		expect(
			await alice.as.mutation(api.bin.put, { workspaceId, name: "a.md" }),
		).toBe(true);
		expect(await names(alice)).toEqual({
			attachments: [],
			bin: ["a.md"],
		});
		expect(
			await alice.as.query(api.attachments.get, { workspaceId, name: "a.md" }),
		).toBeNull();
		expect(
			await alice.as.query(api.bin.get, { workspaceId, name: "a.md" }),
		).toMatchObject({ name: "a.md" });
	});

	it("restores a file to attachments with a fresh week", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await attached(t, workspaceId, "a.md", Date.now());
		const before = Date.now();
		expect(
			await alice.as.mutation(api.bin.restore, { workspaceId, name: "a.md" }),
		).toBeNull();
		const [restored] = await alice.as.query(api.attachments.list, {
			workspaceId,
		});
		expect(restored?.name).toBe("a.md");
		expect(restored?.attachedAt).toBeGreaterThanOrEqual(before);
		expect(
			await alice.as.mutation(api.bin.restore, { workspaceId, name: "a.md" }),
		).toBe("NO_SUCH_FILE");
	});

	it("deletes only what is in the bin", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await attached(t, workspaceId, "kept.md");
		await attached(t, workspaceId, "gone.md", Date.now());
		expect(
			await alice.as.mutation(api.bin.remove, { workspaceId, name: "kept.md" }),
		).toBe(false);
		expect(
			await alice.as.mutation(api.bin.remove, { workspaceId, name: "gone.md" }),
		).toBe(true);
		expect(await names(alice)).toEqual({
			attachments: ["kept.md"],
			bin: [],
		});
	});

	it("empties a file left in the bin past its month, and only that one", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await attached(t, workspaceId, "fresh.md", Date.now());
		await attached(t, workspaceId, "stale.md", Date.now() - BIN_TTL_MS - 1);
		await t.mutation(internal.bin.empty, {});
		expect(await names(alice)).toEqual({
			attachments: [],
			bin: ["fresh.md"],
		});
		expect(
			await t.run((ctx) => ctx.db.system.query("_storage").collect()),
		).toHaveLength(1);
	});
});
