import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import {
	MAX_MCP_REASON_LENGTH,
	MCP_REPORTER_STALE_MS,
} from "../convex/limits.js";
import { harness, type Signed, signIn } from "./helpers.ts";

afterEach(() => {
	vi.useRealTimers();
});

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
describe("the MCP servers a session's host reports", () => {
	it("writes what the workspace's own host reports, keeping the tail of a long reason", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;

		await alice.as.mutation(api.mcpServers.report, {
			reporter: "agent-1",
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

	it("drops the row of a server its host reports gone", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.mcpServers.report, {
			reporter: "agent-1",
			workspaceId,
			server: "fs",
			phase: "ready",
		});

		await alice.as.mutation(api.mcpServers.report, {
			reporter: "agent-1",
			workspaceId,
			server: "fs",
			phase: "gone",
		});

		const { servers } = await alice.as.query(api.mcpServers.list, {
			workspaceId,
		});
		expect(servers).toEqual([]);
	});

	it("refuses a report into someone else's workspace", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const mallory = await signIn(t, "mallory@example.com");

		await expect(
			mallory.as.mutation(api.mcpServers.report, {
				reporter: "agent-1",
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

	it("keeps a status a session reported through the operator's snapshot", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.mcpServers.report, {
			reporter: "agent-1",
			workspaceId,
			server: "remote",
			phase: "ready",
		});

		await t.mutation(internal.mcpServers.reconcile, { servers: [] });

		expect(
			(await alice.as.query(api.mcpServers.list, { workspaceId })).servers,
		).toMatchObject([{ server: "remote", phase: "ready" }]);

		await alice.as.mutation(api.mcpServers.report, {
			reporter: "agent-1",
			workspaceId,
			server: "remote",
			phase: "gone",
		});
		expect(
			(await alice.as.query(api.mcpServers.list, { workspaceId })).servers,
		).toEqual([]);
	});

	it("goes with the workspace", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.mcpServers.report, {
			reporter: "agent-1",
			workspaceId,
			server: "fs",
			phase: "ready",
		});

		await t.mutation(internal.mcpServers.purge, { workspaceId });

		expect(
			(await alice.as.query(api.mcpServers.list, { workspaceId })).servers,
		).toEqual([]);
	});
});

describe("the MCP servers of a host that stops reporting", () => {
	async function phases(as: Signed["as"], workspaceId: Signed["workspace"]) {
		const { servers } = await as.query(api.mcpServers.list, { workspaceId });
		return Object.fromEntries(
			servers.map(({ server, phase, reason }) => [server, { phase, reason }]),
		);
	}

	it("fails the servers a quiet session left running, and keeps the ones it stopped", async () => {
		vi.useFakeTimers();
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		for (const [server, phase] of [
			["notes", "ready"],
			["fs", "starting"],
			["sheets", "sleeping"],
		] as const)
			await alice.as.mutation(api.mcpServers.report, {
				workspaceId,
				reporter: "agent-1",
				server,
				phase,
			});

		vi.advanceTimersByTime(MCP_REPORTER_STALE_MS + 1);
		await t.mutation(internal.mcpServers.sweep, {});

		expect(await phases(alice.as, workspaceId)).toEqual({
			notes: { phase: "failed", reason: "its host stopped reporting." },
			fs: { phase: "failed", reason: "its host stopped reporting." },
			sheets: { phase: "sleeping", reason: undefined },
		});
	});

	it("keeps a session's servers running while it beats, and takes its word back after a gap", async () => {
		vi.useFakeTimers();
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.mcpServers.report, {
			workspaceId,
			reporter: "agent-1",
			server: "notes",
			phase: "ready",
		});
		const beat = () =>
			alice.as.mutation(api.mcpServers.heartbeat, {
				workspaceId,
				reporter: "agent-1",
				servers: [{ server: "notes", phase: "ready" }],
			});

		vi.advanceTimersByTime(MCP_REPORTER_STALE_MS - 1);
		await beat();
		vi.advanceTimersByTime(MCP_REPORTER_STALE_MS - 1);
		await t.mutation(internal.mcpServers.sweep, {});
		expect((await phases(alice.as, workspaceId)).notes?.phase).toBe("ready");

		vi.advanceTimersByTime(2);
		await t.mutation(internal.mcpServers.sweep, {});
		expect((await phases(alice.as, workspaceId)).notes?.phase).toBe("failed");

		await beat();
		expect((await phases(alice.as, workspaceId)).notes?.phase).toBe("ready");
	});

	it("fails what a quiet operator left running, until its next snapshot", async () => {
		vi.useFakeTimers();
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		const snapshot = () =>
			t.mutation(internal.mcpServers.reconcile, {
				servers: [{ workspaceId, server: "playwright", phase: "ready" }],
			});
		await snapshot();

		vi.advanceTimersByTime(MCP_REPORTER_STALE_MS + 1);
		await t.mutation(internal.mcpServers.sweep, {});
		expect(await phases(alice.as, workspaceId)).toEqual({
			playwright: { phase: "failed", reason: "its host stopped reporting." },
		});

		await snapshot();
		expect(await phases(alice.as, workspaceId)).toEqual({
			playwright: { phase: "ready", reason: undefined },
		});
	});

	it("refuses a beat for a host of someone else's workspace, or in the operator's name", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const mallory = await signIn(t, "mallory@example.com");
		await alice.as.mutation(api.mcpServers.report, {
			workspaceId: alice.workspace,
			reporter: "agent-1",
			server: "notes",
			phase: "ready",
		});

		await expect(
			mallory.as.mutation(api.mcpServers.heartbeat, {
				workspaceId: mallory.workspace,
				reporter: "agent-1",
				servers: [{ server: "notes", phase: "failed" }],
			}),
		).rejects.toThrow();
		await expect(
			mallory.as.mutation(api.mcpServers.heartbeat, {
				workspaceId: mallory.workspace,
				reporter: "operator",
				servers: [],
			}),
		).rejects.toThrow();
		expect(
			(
				await alice.as.query(api.mcpServers.list, {
					workspaceId: alice.workspace,
				})
			).servers,
		).toMatchObject([{ server: "notes", phase: "ready" }]);
	});
});
