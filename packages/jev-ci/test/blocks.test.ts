import { describe, expect, it } from "vitest";
import { chunk, mentions } from "../src/blocks.ts";

const SAMPLE = [
	"# AGENTS.md",
	"",
	"Guidance for agents.",
	"",
	"## Packages",
	"",
	"- `packages/interpreter` (`@repo/interpreter`) — the language itself.",
	"- `packages/mcp` (`@repo/mcp`) — the MCP extension.",
	"  Carries the SDK.",
	"",
	"### Commands",
	"",
	"```bash",
	"pnpm test                    # turbo run test",
	"pnpm check:arch",
	"```",
].join("\n");

describe("chunk", () => {
	it("carries the heading path down to the block", () => {
		const blocks = chunk(SAMPLE);

		expect(blocks[0].heading).toBe("AGENTS.md");
		expect(blocks[1].heading).toBe("AGENTS.md > Packages");
		expect(blocks.at(-1)?.heading).toBe("AGENTS.md > Packages > Commands");
	});

	it("splits a list into one block per bullet, with its own line", () => {
		const blocks = chunk(SAMPLE).filter((block) =>
			block.text.startsWith("- `packages/"),
		);

		expect(blocks).toHaveLength(2);
		expect(blocks[0].line).toBe(7);
		expect(blocks[1].line).toBe(8);
		expect(blocks[1].text).toContain("Carries the SDK.");
	});

	it("keeps a fenced block whole", () => {
		const fenced = chunk(SAMPLE).filter((block) =>
			block.text.startsWith("```"),
		);

		expect(fenced).toHaveLength(1);
		expect(fenced[0].text).toContain("pnpm check:arch");
	});

	it("points a block at the line it starts on", () => {
		const blocks = chunk(SAMPLE);

		expect(blocks[0].text).toBe("Guidance for agents.");
		expect(blocks[0].line).toBe(3);
	});

	it("keeps a heading that skips a level from swallowing its parent", () => {
		const blocks = chunk("# One\n\n### Three\n\ntext\n");

		expect(blocks[0].heading).toBe("One > Three");
	});
});

describe("mentions", () => {
	it("reads every backticked token once", () => {
		const [block] = chunk("- `a/b.ts` and `a/b.ts` and `@repo/x`");

		expect(mentions(block)).toEqual(["a/b.ts", "@repo/x"]);
	});

	it("reads a fenced block as the commands it runs, without the comments", () => {
		const fenced = chunk(SAMPLE).filter((block) =>
			block.text.startsWith("```"),
		);

		expect(mentions(fenced[0])).toEqual(["pnpm test", "pnpm check:arch"]);
	});

	it("leaves an ascii diagram out of the mentions", () => {
		const [block] = chunk("```\ninterpreter  →  extensions\n```");

		expect(mentions(block)).toEqual([]);
	});
});
