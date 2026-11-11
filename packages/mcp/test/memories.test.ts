import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";

describe("the mcp memories", () => {
	it("fill every value they take from code", () => {
		const { memories } = mcpExtension(mcpHost);
		expect(memories).not.toMatch(/\{\{|\}\}/);
	});
});
