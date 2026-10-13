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

describe("a server's phase, told to the chats that hold it", () => {
	async function holding(servers: string[]) {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		const holder = await alice.as.mutation(api.chats.create, { workspaceId });
		const bystander = await alice.as.mutation(api.chats.create, {
			workspaceId,
		});
		await alice.as.mutation(api.context.watch, {
			chatId: holder,
			source: "mcp",
			keys: servers,
		});
		await t.mutation(internal.mcpServers.observeServer, {
			workspaceId,
			server: "fs",
			phase: "starting",
		});
		await t.mutation(internal.mcpServers.observeServer, {
			workspaceId,
			server: "fs",
			phase: "ready",
		});
		const transcript = (chatId: typeof holder) =>
			alice.as.query(api.messages.transcript, { chatId });
		const release = () =>
			alice.as.mutation(api.context.watch, {
				chatId: holder,
				source: "mcp",
				keys: [],
			});
		return { t, workspaceId, holder, bystander, release, transcript };
	}

	it("says nothing while the server comes up", async () => {
		const { holder, transcript } = await holding(["fs"]);
		expect(await transcript(holder)).toEqual([]);
	});

	it("leaves a system message in the holding chat when the server sleeps, and once per change", async () => {
		const { t, workspaceId, holder, bystander, transcript } = await holding([
			"fs",
		]);
		await t.mutation(internal.mcpServers.observeServer, {
			workspaceId,
			server: "fs",
			phase: "sleeping",
		});
		await t.mutation(internal.mcpServers.reconcile, {
			servers: [{ workspaceId, server: "fs", phase: "sleeping" }],
			state: [],
		});

		const told = await transcript(holder);
		expect(told).toHaveLength(1);
		expect(told[0]).toMatchObject({
			type: "system",
			kwargs: { source: "context/mcp" },
		});
		expect(told[0]?.content).toContain('"fs" was stopped after going unused');
		expect(told[0]?.content).toContain('(load-mcp "fs")');
		expect(await transcript(bystander)).toEqual([]);
	});

	it("names the reason a server failed", async () => {
		const { t, workspaceId, holder, transcript } = await holding(["fs"]);
		await t.mutation(internal.mcpServers.observeServer, {
			workspaceId,
			server: "fs",
			phase: "failed",
			reason: "CrashLoopBackOff",
		});

		const [told] = await transcript(holder);
		expect(told?.content).toContain('"fs" failed (CrashLoopBackOff)');
	});

	it("tells the holding chat a server was deleted", async () => {
		const { t, workspaceId, holder, transcript } = await holding(["fs"]);
		await t.mutation(internal.mcpServers.observeServer, {
			workspaceId,
			server: "fs",
			phase: "gone",
		});

		const told = await transcript(holder);
		expect(told).toHaveLength(1);
		expect(told[0]?.content).toContain('"fs" was removed');
	});

	it("tells the holding chat a server the snapshot dropped is gone", async () => {
		const { t, holder, transcript } = await holding(["fs"]);
		await t.mutation(internal.mcpServers.reconcile, {
			servers: [],
			state: [],
		});

		const told = await transcript(holder);
		expect(told).toHaveLength(1);
		expect(told[0]?.content).toContain('"fs" was removed');
	});

	it("tells a chat nothing about a server it let go of", async () => {
		const { t, workspaceId, holder, release, transcript } = await holding([
			"fs",
		]);
		await release();
		await t.mutation(internal.mcpServers.observeServer, {
			workspaceId,
			server: "fs",
			phase: "sleeping",
		});
		expect(await transcript(holder)).toEqual([]);
	});
});
