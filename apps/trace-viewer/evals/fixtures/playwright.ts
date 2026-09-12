import { readFileSync } from "node:fs";
import type { MockServer, MockTool } from "@repo/evals/mocks";

const tools = JSON.parse(
	readFileSync(new URL("./playwright.tools.json", import.meta.url), "utf8"),
) as MockTool[];

const SNAPSHOT = [
	"- banner:",
	'  - heading "Build AI workflows visually" [level=1]',
	'  - link "Pricing"',
];

const PAGE = {
	url: "https://hyko.ai/",
	title: "hyko",
	snapshot: SNAPSHOT.join("\n"),
};

function find(args: Record<string, unknown>): { matches: string[] } {
	const text = String(args.text ?? "");
	const keep = args.regex
		? (line: string) => new RegExp(String(args.regex)).test(line)
		: (line: string) => line.toLowerCase().includes(text.toLowerCase());
	return { matches: SNAPSHOT.filter(keep).map((line) => line.trim()) };
}

export const playwright: MockServer = {
	tools,
	connectDelayMs: 40,
	otherwise: { ok: true },
	calls: {
		browser_navigate: (args) => ({ url: args.url, title: PAGE.title }),
		browser_snapshot: () => ({ url: PAGE.url, snapshot: PAGE.snapshot }),
		browser_find: find,
		browser_click: () => ({ ok: true }),
		browser_close: () => ({ ok: true }),
	},
};
