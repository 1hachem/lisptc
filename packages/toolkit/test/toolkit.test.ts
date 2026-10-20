import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../mcp.toolkit.json" with { type: "json" };
import { TOOLKIT_URL } from "../src/toolkit.ts";

describe("the toolkit manifest", () => {
	it("is found at the URL the package exports", () => {
		const entries = JSON.parse(readFileSync(TOOLKIT_URL, "utf8"));
		expect(entries.map((e: { name: string }) => e.name)).toEqual(
			manifest.map((t) => t.name),
		);
	});

	it("names every toolkit once, with a description", () => {
		const names = manifest.map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
		for (const toolkit of manifest) expect(toolkit.description).toBeTruthy();
	});
});
