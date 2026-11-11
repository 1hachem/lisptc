import { describe, expect, it } from "vitest";
import { workspaceServers } from "../src/components/mcp-servers.tsx";

describe("the workspace's MCP servers", () => {
	it("joins what is loaded, what runs and what was last read", () => {
		expect(
			workspaceServers(
				[
					{ server: "fs", phase: "ready", observedAt: 1 },
					{
						server: "playwright",
						phase: "starting",
						reason: "pulling its image",
						observedAt: 1,
					},
				],
				["fs"],
				[
					{
						server: "sheets",
						description: "Google Sheets",
						icon: "https://example.com/sheets.png",
						login: true,
						tools: JSON.stringify([
							{ name: "read", description: "reads a range", inputSchema: {} },
						]),
						fetchedAt: 7,
					},
				],
			),
		).toEqual([
			{ server: "fs", phase: "ready", mounted: true, login: false, tools: [] },
			{
				server: "playwright",
				phase: "starting",
				reason: "pulling its image",
				mounted: false,
				login: false,
				tools: [],
			},
			{
				server: "sheets",
				mounted: false,
				description: "Google Sheets",
				icon: "https://example.com/sheets.png",
				login: true,
				tools: [{ name: "read", description: "reads a range" }],
				fetchedAt: 7,
			},
		]);
	});
});
