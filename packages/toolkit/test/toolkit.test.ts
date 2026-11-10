import { describe, expect, it } from "vitest";
import {
	bundledEntries,
	devEntries,
	machineEntries,
	type ToolkitEntry,
} from "../src/toolkit.ts";

const manifests: [string, readonly ToolkitEntry[]][] = [
	["bundled", bundledEntries],
	["dev", devEntries],
	["machine", machineEntries],
];

describe.each(manifests)("the %s manifest", (_, entries) => {
	it("names every server once", () => {
		const names = entries.map((entry) => entry.name);
		expect(new Set(names).size).toBe(names.length);
	});
});

describe("the machine manifest", () => {
	it("carries no variable for the server to expand", () => {
		for (const entry of machineEntries)
			expect(JSON.stringify(entry)).not.toContain("${");
	});
});
