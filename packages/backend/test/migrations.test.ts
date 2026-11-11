import migrationsTest from "@convex-dev/migrations/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import { harness, signIn } from "./helpers.ts";

afterEach(() => {
	vi.useRealTimers();
});

describe("migrations", () => {
	it("drop the preferences saved before they belonged to a workspace", async () => {
		const t = harness();
		migrationsTest.register(t);
		const alice = await signIn(t, "alice@example.com");
		await alice.as.mutation(api.preferences.put, {
			workspaceId: alice.workspace,
			preferences: { font: "mono" },
		});
		await t.run(async (ctx) => {
			await ctx.db.insert("preferences", { userId: alice.user, font: "serif" });
		});

		vi.useFakeTimers();
		await t.mutation(internal.migrations.runAll, {});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const left = await t.run(
			async (ctx) => await ctx.db.query("preferences").collect(),
		);
		expect(left.map((row) => row.workspaceId)).toEqual([alice.workspace]);
		expect(
			await alice.as.query(api.preferences.get, {
				workspaceId: alice.workspace,
			}),
		).toMatchObject({ font: "mono" });
	});

	it("hand the MCP statuses written before reporters to the operator, and drop the session's", async () => {
		const t = harness();
		migrationsTest.register(t);
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await t.run(async (ctx) => {
			for (const [server, reporter] of [
				["playwright", undefined],
				["linear", "session"],
			] as const)
				await ctx.db.insert("mcpServers", {
					workspaceId,
					server,
					phase: "ready",
					...(reporter === undefined ? {} : { reporter }),
					observedAt: 0,
				});
		});

		vi.useFakeTimers();
		await t.mutation(internal.migrations.runAll, {});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		await t.mutation(internal.mcpServers.reconcile, { servers: [] });

		expect(
			(await alice.as.query(api.mcpServers.list, { workspaceId })).servers,
		).toEqual([]);
	});
});
