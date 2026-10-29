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

describe("the MCP servers a workspace has loaded", () => {
	it("keeps one mount per server, replaced when its tools change and gone on unmount", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		const tools = JSON.stringify([{ name: "echo" }]);

		await alice.as.mutation(api.mcpServers.mount, {
			workspaceId,
			server: "fx",
			tools,
		});
		await alice.as.mutation(api.mcpServers.mount, {
			workspaceId,
			server: "fx",
			tools: JSON.stringify([{ name: "echo" }, { name: "add" }]),
		});
		await alice.as.mutation(api.mcpServers.mount, {
			workspaceId,
			server: "remote",
			conf: JSON.stringify({ name: "remote", url: "https://x.test/mcp" }),
			tools,
		});

		const mounts = await alice.as.query(api.mcpServers.mounts, {
			workspaceId,
		});
		expect(mounts.sort((a, b) => a.server.localeCompare(b.server))).toEqual([
			{
				server: "fx",
				tools: JSON.stringify([{ name: "echo" }, { name: "add" }]),
			},
			{
				server: "remote",
				conf: JSON.stringify({ name: "remote", url: "https://x.test/mcp" }),
				tools,
			},
		]);

		await alice.as.mutation(api.mcpServers.unmount, {
			workspaceId,
			server: "fx",
		});
		expect(
			(await alice.as.query(api.mcpServers.mounts, { workspaceId })).map(
				(mount) => mount.server,
			),
		).toEqual(["remote"]);
	});

	it("survives the operator's snapshot, which owns only the status", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.mcpServers.mount, {
			workspaceId,
			server: "fx",
			tools: "[]",
		});

		await t.mutation(internal.mcpServers.reconcile, { servers: [], state: [] });

		expect(
			await alice.as.query(api.mcpServers.mounts, { workspaceId }),
		).toEqual([{ server: "fx", tools: "[]" }]);
	});

	it("refuses a mount into someone else's workspace", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const mallory = await signIn(t, "mallory@example.com");

		await expect(
			mallory.as.mutation(api.mcpServers.mount, {
				workspaceId: alice.workspace,
				server: "fx",
				tools: "[]",
			}),
		).rejects.toThrow();
		await expect(
			mallory.as.query(api.mcpServers.mounts, {
				workspaceId: alice.workspace,
			}),
		).rejects.toThrow();
	});

	it("goes with the workspace", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.mcpServers.mount, {
			workspaceId,
			server: "fx",
			tools: "[]",
		});

		await t.mutation(internal.mcpServers.purge, { workspaceId });

		expect(await t.run((ctx) => ctx.db.query("mcpMounts").collect())).toEqual(
			[],
		);
	});
});
