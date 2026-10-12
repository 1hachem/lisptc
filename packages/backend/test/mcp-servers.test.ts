import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import { harness, signIn } from "./helpers.ts";

describe("the MCP servers the operator mirrors", () => {
	it("takes the cluster's snapshot as the truth, writing what it missed and dropping what is gone", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await t.mutation(internal.mcpServers.observeServer, {
			workspaceId,
			server: "playwright",
			phase: "starting",
		});
		await t.mutation(internal.mcpServers.observeServer, {
			workspaceId,
			server: "fs",
			phase: "ready",
		});

		await t.mutation(internal.mcpServers.reconcile, {
			servers: [
				{
					workspaceId,
					server: "playwright",
					phase: "failed",
					reason: "ImagePullBackOff",
				},
				{ workspaceId, server: "github", phase: "sleeping" },
			],
			state: [],
		});

		const { servers } = await alice.as.query(api.mcpServers.list, {
			workspaceId,
		});
		expect(
			servers
				.map(({ server, phase, reason }) => ({ server, phase, reason }))
				.sort((a, b) => a.server.localeCompare(b.server)),
		).toEqual([
			{ server: "github", phase: "sleeping", reason: undefined },
			{ server: "playwright", phase: "failed", reason: "ImagePullBackOff" },
		]);
	});
});
