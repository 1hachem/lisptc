import { describe, expect, it } from "vitest";
import { nameSearchEngine } from "../src/name-search.ts";
import { nearest } from "../src/ports.ts";

function near(name: string, candidates: readonly string[]): string | undefined {
	return nearest(nameSearchEngine, name, candidates);
}

const PLAYWRIGHT = [
	"playwright/browser_navigate",
	"playwright/browser_close",
	"playwright/browser_snapshot",
	"playwright/browser_click",
];

describe("the nearest name under the same qualifier", () => {
	it("finds the longer name a short one is contained in", () => {
		expect(near("playwright/navigate", PLAYWRIGHT)).toBe(
			"playwright/browser_navigate",
		);
	});

	it("finds a name a letter swap away", () => {
		expect(near("playwright/browser_cilck", PLAYWRIGHT)).toBe(
			"playwright/browser_click",
		);
	});

	it("offers nothing from another server", () => {
		expect(near("puppeteer/navigate", PLAYWRIGHT)).toBeUndefined();
	});

	it("offers nothing unqualified for a qualified miss", () => {
		expect(near("playwright/navigate", ["navigate", "car"])).toBeUndefined();
	});

	it("offers nothing when no candidate is close", () => {
		expect(near("playwright/teleport", PLAYWRIGHT)).toBeUndefined();
	});

	it("prefers the shortest of several containing names", () => {
		expect(near("x/get", ["x/get_one", "x/get_one_thing", "x/put"])).toBe(
			"x/get_one",
		);
	});

	it("never offers the name that failed", () => {
		expect(near("x/get", ["x/get"])).toBeUndefined();
	});

	it("does not take a one-character name for a match inside a long one", () => {
		expect(near("utterly-unrelated-name", ["-", "+", "car"])).toBeUndefined();
	});

	it("matches a name the candidate was prefixed onto, not one buried in it", () => {
		expect(near("report-the-thing", ["or", "the", "re"])).toBeUndefined();
		expect(near("click", ["browser_click", "snapshot"])).toBe("browser_click");
	});

	it("matches unqualified names against unqualified candidates", () => {
		expect(near("lenght", ["length", "last", "list"])).toBe("length");
	});

	it("reaches into a loaded server for a miss that names none", () => {
		expect(near("navigate", PLAYWRIGHT)).toBe("playwright/browser_navigate");
	});

	it("takes the closest name whatever qualifier carries it", () => {
		expect(near("click", ["click_here", ...PLAYWRIGHT])).toBe("click_here");
	});

	it("offers nothing from a server when nothing there is close", () => {
		expect(near("teleport", PLAYWRIGHT)).toBeUndefined();
	});

	it("finds a name whose segment the typed one begins", () => {
		expect(near("playwright/nav", PLAYWRIGHT)).toBe(
			"playwright/browser_navigate",
		);
		expect(near("playwright/snap", PLAYWRIGHT)).toBe(
			"playwright/browser_snapshot",
		);
	});

	it("finds a name a letter swap away from one of its segments", () => {
		expect(near("playwright/nvigate", PLAYWRIGHT)).toBe(
			"playwright/browser_navigate",
		);
	});

	it("does not take a fragment buried inside a segment", () => {
		expect(near("playwright/ser", PLAYWRIGHT)).toBeUndefined();
	});
});
