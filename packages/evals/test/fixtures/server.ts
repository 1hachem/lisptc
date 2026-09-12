import type { MockServer } from "../../src/mocks.ts";

export const playwright: MockServer = {
	connectDelayMs: 30,
	tools: [
		{
			name: "browser_navigate",
			description: "Navigate to a URL",
			inputSchema: {
				type: "object",
				properties: { url: { type: "string" } },
				required: ["url"],
			},
		},
		{ name: "browser_snapshot", description: "Snapshot the page" },
		{ name: "browser_click", description: "Click an element" },
	],
	calls: {
		browser_navigate: (args) => ({ url: args.url, title: "hyko" }),
		browser_snapshot: { heading: "Build AI workflows visually" },
		browser_click: { ok: true },
	},
};
