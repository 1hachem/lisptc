import { describe, expect, it } from "vitest";
import manifest from "../mcp.toolkit.json" with { type: "json" };

describe("the toolkit manifest", () => {
	it("names every toolkit once, with a description", () => {
		const names = manifest.map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
		for (const toolkit of manifest) expect(toolkit.description).toBeTruthy();
	});
});
