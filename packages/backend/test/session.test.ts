import { afterEach, describe, expect, it, vi } from "vitest";
import { api, components } from "../convex/_generated/api.js";
import { signIn, testDeployment } from "./helpers.ts";

afterEach(() => {
	vi.useRealTimers();
});

describe("an account's session", () => {
	it("lists the workspaces of a signed-in account", async () => {
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		const listed = await alice.as.query(api.workspaces.list, {});
		expect(listed.map((w) => w._id)).toEqual([alice.workspace]);
	});

	it("rejects an identity that names no session", async () => {
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		const sessionless = t.withIdentity({ subject: alice.authId });
		await expect(sessionless.query(api.workspaces.list, {})).rejects.toThrow(
			/UNAUTHENTICATED/,
		);
	});

	it("rejects a session that has expired", async () => {
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
		await expect(alice.as.query(api.workspaces.list, {})).rejects.toThrow(
			/UNAUTHENTICATED/,
		);
	});

	it("rejects a session that was signed out", async () => {
		const t = testDeployment();
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
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		const forged = t.withIdentity({
			subject: alice.authId,
			sessionId: "forged",
		});
		await expect(forged.query(api.workspaces.list, {})).rejects.toThrow(
			/UNAUTHENTICATED/,
		);
	});

	it("rejects an identity pairing one account with another account's session", async () => {
		const t = testDeployment();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		const mixed = t.withIdentity({
			subject: bob.authId,
			sessionId: alice.sessionId,
		});
		await expect(mixed.query(api.workspaces.list, {})).rejects.toThrow(
			/UNAUTHENTICATED/,
		);
	});
});
