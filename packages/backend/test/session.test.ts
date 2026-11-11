import { afterEach, describe, expect, it, vi } from "vitest";
import { api, components } from "../convex/_generated/api.js";
import { harness, signIn } from "./helpers.ts";

afterEach(() => {
	vi.useRealTimers();
});

describe("an account's session", () => {
	it("lists the workspaces of a signed-in account", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const listed = await alice.as.query(api.workspaces.list, {});
		expect(listed.map((w) => w._id)).toEqual([alice.workspace]);
	});

	it("rejects a caller with no identity", async () => {
		const t = harness();
		await expect(t.query(api.workspaces.list, {})).rejects.toThrow(
			/UNAUTHENTICATED/,
		);
	});

	it("rejects a session that has expired", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
		await expect(alice.as.query(api.workspaces.list, {})).rejects.toThrow(
			/UNAUTHENTICATED/,
		);
	});

	it("rejects a session that was signed out", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await t.run(async (ctx) => {
			await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
				input: { model: "session" },
				paginationOpts: { cursor: null, numItems: 10 },
			});
		});
		await expect(alice.as.query(api.workspaces.list, {})).rejects.toThrow(
			/UNAUTHENTICATED/,
		);
	});

	it("rejects an identity naming a session that never existed", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const authId = await t.run(
			async (ctx) => (await ctx.db.get(alice.user))?.authId,
		);
		const forged = t.withIdentity({ subject: authId, sessionId: "forged" });
		await expect(forged.query(api.workspaces.list, {})).rejects.toThrow(
			/UNAUTHENTICATED/,
		);
	});

	it("rejects an identity pairing one account with another account's session", async () => {
		const t = harness();
		await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		const { bobAuthId, aliceSessionId } = await t.run(async (ctx) => {
			const bobUser = await ctx.db.get(bob.user);
			const sessions = (await ctx.runQuery(
				components.betterAuth.adapter.findMany,
				{
					model: "session",
					where: [{ field: "token", value: "token-alice@example.com" }],
					paginationOpts: { cursor: null, numItems: 1 },
				},
			)) as { page: { _id: string }[] };
			return {
				bobAuthId: bobUser?.authId,
				aliceSessionId: sessions.page[0]?._id,
			};
		});
		const mixed = t.withIdentity({
			subject: bobAuthId,
			sessionId: aliceSessionId,
		});
		await expect(mixed.query(api.workspaces.list, {})).rejects.toThrow(
			/UNAUTHENTICATED/,
		);
	});
});
