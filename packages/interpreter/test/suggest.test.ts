import { describe, expect, it } from "vitest";
import { suggestNames } from "../src/suggest.ts";

const CATALOG = [
	"search-mcps",
	"load-mcp",
	"list-mcps",
	"list-tools",
	"search-tools",
	"playwright/browser_navigate",
	"playwright/browser_snapshot",
	"car",
	"cons",
];

describe("suggestNames", () => {
	it("matches a name that differs only in its separators", () => {
		expect(suggestNames(CATALOG, "search_mcps")[0]).toBe("search-mcps");
		expect(suggestNames(CATALOG, "load_mcp")[0]).toBe("load-mcp");
	});

	it("matches across a dropped token in a namespaced tool name", () => {
		expect(suggestNames(CATALOG, "playwright/navigate")).toContain(
			"playwright/browser_navigate",
		);
	});

	it("matches a small typo", () => {
		expect(suggestNames(CATALOG, "cens")).toContain("cons");
	});

	it("offers nothing for a name with no near match", () => {
		expect(suggestNames(CATALOG, "frobnicate")).toEqual([]);
	});

	it("returns at most three names", () => {
		expect(suggestNames(CATALOG, "list").length).toBeLessThanOrEqual(3);
	});
});
