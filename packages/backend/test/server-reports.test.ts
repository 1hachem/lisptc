import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import { MCP_REPORT_BEAT_MS, MCP_REPORTER_STALE_MS } from "../convex/limits.js";
import { type ReportsClient, reportsOf } from "../src/server-reports.ts";
import { harness, signIn } from "./helpers.ts";

afterEach(() => {
	vi.useRealTimers();
});

async function signedReporter() {
	const t = harness();
	const alice = await signIn(t, "alice@example.com");
	const workspaceId = alice.workspace;
	const report = reportsOf(workspaceId, () => alice.as as ReportsClient);
	const chatId = await alice.as.mutation(api.chats.create, { workspaceId });
	const phaseOf = async (server: string, instance?: string) =>
		(await alice.as.query(api.mcpServers.list, { workspaceId })).servers.find(
			(row) => row.server === server && row.instance === instance,
		)?.phase;
	const sweepAfter = async (ms: number) => {
		for (let left = ms; left > 0; left -= MCP_REPORT_BEAT_MS)
			await vi.advanceTimersByTimeAsync(Math.min(left, MCP_REPORT_BEAT_MS));
		await t.mutation(internal.mcpServers.sweep, {});
	};
	return { report, phaseOf, sweepAfter, chatId };
}

describe("what a session's hosts report", () => {
	it("keeps a running server ready for as long as the session lives", async () => {
		vi.useFakeTimers();
		const { report, phaseOf, sweepAfter } = await signedReporter();

		report({ server: "notes", phase: "ready" });
		await sweepAfter(MCP_REPORTER_STALE_MS * 3);

		expect(await phaseOf("notes")).toBe("ready");
	});

	it("leaves a stopped server asleep once nothing it holds runs", async () => {
		vi.useFakeTimers();
		const { report, phaseOf, sweepAfter } = await signedReporter();

		report({ server: "notes", phase: "ready" });
		report({ server: "notes", phase: "sleeping" });
		await sweepAfter(MCP_REPORTER_STALE_MS * 3);

		expect(await phaseOf("notes")).toBe("sleeping");
	});

	it("drops a removed server's row", async () => {
		vi.useFakeTimers();
		const { report, phaseOf, sweepAfter } = await signedReporter();

		report({ server: "notes", phase: "ready" });
		report({ server: "notes", phase: "gone" });
		await sweepAfter(MCP_REPORT_BEAT_MS);

		expect(await phaseOf("notes")).toBeUndefined();
	});

	it("keeps a chat's own server apart from the workspace's of the same name", async () => {
		vi.useFakeTimers();
		const { report, phaseOf, sweepAfter, chatId } = await signedReporter();

		report({ server: "notes", phase: "ready" });
		report({ server: "notes", instance: chatId, phase: "ready" });
		report({ server: "notes", instance: chatId, phase: "sleeping" });
		await sweepAfter(MCP_REPORTER_STALE_MS * 3);

		expect([await phaseOf("notes"), await phaseOf("notes", chatId)]).toEqual([
			"ready",
			"sleeping",
		]);
	});
});
