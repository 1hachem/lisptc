import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import type { LispPromise } from "@repo/interpreter/promise";
import { describe, expect, it, vi } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";
import type { McpClient, ToolCall } from "../src/ports.ts";

function stallingClient(): { client: McpClient; calls: ToolCall[] } {
	const calls: ToolCall[] = [];
	return {
		calls,
		client: {
			connect: async () => ({
				serverId: "s1",
				tools: [
					{
						name: "crawl",
						description: "Crawl a site.",
						inputSchema: {
							type: "object",
							properties: { url: { type: "string" } },
						},
					},
				],
			}),
			callTool: (call) => {
				calls.push(call);
				return new Promise(() => {});
			},
			disconnect: () => Promise.resolve(),
			login: () => Promise.resolve({ authUrl: null }),
			logout: () => Promise.resolve(),
			authorize: () => Promise.resolve(),
			shutdown: () => Promise.resolve(),
		},
	};
}

async function loaded(client: McpClient): Promise<Interp> {
	const interp = new Interp({
		extensions: [mcpExtension({ ...mcpHost, client })],
	});
	runSync(interp, prelude);
	await (runSync(
		interp,
		'(load-mcp :name "x" :command "node")',
	) as LispPromise);
	return interp;
}

describe("a tool call's timeout", () => {
	it("waits two minutes by default, and tells the client so", async () => {
		const { client, calls } = stallingClient();
		const interp = await loaded(client);
		runAsync(interp, '(x/crawl :url "https://a.test")').catch(() => {});
		await vi.waitFor(() => expect(calls).toHaveLength(1));
		expect(calls).toEqual([
			{
				serverId: "s1",
				tool: "crawl",
				args: { url: "https://a.test" },
				timeoutMs: 120_000,
			},
		]);
		interp.dispose();
	});

	it("takes :mcp/timeout in seconds, keeps it from the server, and fails when it runs out", async () => {
		const { client, calls } = stallingClient();
		const interp = await loaded(client);
		await expect(
			runAsync(interp, '(x/crawl :url "https://a.test" :mcp/timeout 0.05)'),
		).rejects.toThrow("x/crawl timed out");
		expect(calls[0]?.args).toEqual({ url: "https://a.test" });
		expect(calls[0]?.timeoutMs).toBe(50);
	});

	it("refuses a timeout that is not a positive number of seconds within the cap", async () => {
		const { client, calls } = stallingClient();
		const interp = await loaded(client);
		for (const given of ["0", "-5", "901", '"soon"'])
			await expect(
				runAsync(interp, `(x/crawl :mcp/timeout ${given})`),
			).rejects.toThrow("is seconds, above 0 and at most 900");
		expect(calls).toEqual([]);
	});
});
