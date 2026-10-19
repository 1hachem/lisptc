import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOLKIT_URL, toolkits } from "../src/toolkit.ts";

describe("the toolkit manifest", () => {
	it("is found at the URL the package exports", () => {
		const entries = JSON.parse(readFileSync(TOOLKIT_URL, "utf8"));
		expect(entries.map((e: { name: string }) => e.name)).toEqual(
			toolkits.map((t) => t.name),
		);
	});

	it("names every toolkit once, with a description", () => {
		const names = toolkits.map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
		for (const toolkit of toolkits) expect(toolkit.description).toBeTruthy();
	});
});
