import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import { MAX_MCP_REASON_LENGTH } from "../convex/limits.js";
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
describe("the MCP servers a docker host reports", () => {
	it("writes what the workspace's own host reports, keeping the tail of a long reason", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;

		await alice.as.mutation(api.mcpServers.report, {
			workspaceId,
			server: "playwright",
			phase: "failed",
			reason: `${"x".repeat(MAX_MCP_REASON_LENGTH)}its container exited.`,
		});

		const { servers } = await alice.as.query(api.mcpServers.list, {
			workspaceId,
		});
		expect(servers).toHaveLength(1);
		expect(servers[0]?.phase).toBe("failed");
		expect(servers[0]?.reason).toHaveLength(MAX_MCP_REASON_LENGTH);
		expect(servers[0]?.reason?.endsWith("its container exited.")).toBe(true);
	});

	it("refuses a report into someone else's workspace", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const mallory = await signIn(t, "mallory@example.com");

		await expect(
			mallory.as.mutation(api.mcpServers.report, {
				workspaceId: alice.workspace,
				server: "playwright",
				phase: "ready",
			}),
		).rejects.toThrow();
		const { servers } = await alice.as.query(api.mcpServers.list, {
			workspaceId: alice.workspace,
		});
		expect(servers).toEqual([]);
	});
});
