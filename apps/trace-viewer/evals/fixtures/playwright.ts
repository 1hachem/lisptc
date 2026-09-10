import { readFileSync } from "node:fs";
import type { MockServer, MockTool } from "@repo/evals/mocks";

const tools = JSON.parse(
	readFileSync(new URL("./playwright.tools.json", import.meta.url), "utf8"),
) as MockTool[];

const PAGE = {
	url: "https://hyko.ai/",
	title: "hyko",
	snapshot: [
		"- banner:",
		'  - heading "Build AI workflows visually" [level=1]',
		'  - link "Pricing"',
	].join("\n"),
};

export const playwright: MockServer = {
	tools,
	connectDelayMs: 40,
	calls: {
		browser_navigate: (args) => ({ url: args.url, title: PAGE.title }),
		browser_snapshot: () => ({ url: PAGE.url, snapshot: PAGE.snapshot }),
		browser_find: () => ({ matches: [] }),
		browser_click: () => ({ ok: true }),
		browser_close: () => ({ ok: true }),
	},
};
