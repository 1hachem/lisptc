import { describe, expect, it } from "vitest";
import { nearest } from "../src/ports.ts";

const PLAYWRIGHT = [
	"playwright/browser_navigate",
	"playwright/browser_close",
	"playwright/browser_snapshot",
	"playwright/browser_click",
];

describe("the nearest name under the same qualifier", () => {
	it("finds the longer name a short one is contained in", () => {
		expect(nearest("playwright/navigate", PLAYWRIGHT)).toBe(
			"playwright/browser_navigate",
		);
	});

	it("finds a name a letter swap away", () => {
		expect(nearest("playwright/browser_cilck", PLAYWRIGHT)).toBe(
			"playwright/browser_click",
		);
	});

	it("offers nothing from another server", () => {
		expect(nearest("puppeteer/navigate", PLAYWRIGHT)).toBeUndefined();
	});

	it("offers nothing unqualified for a qualified miss", () => {
		expect(nearest("playwright/navigate", ["navigate", "car"])).toBeUndefined();
	});

	it("offers nothing when no candidate is close", () => {
		expect(nearest("playwright/teleport", PLAYWRIGHT)).toBeUndefined();
	});

	it("prefers the shortest of several containing names", () => {
		expect(nearest("x/get", ["x/get_one", "x/get_one_thing", "x/put"])).toBe(
			"x/get_one",
		);
	});

	it("never offers the name that failed", () => {
		expect(nearest("x/get", ["x/get"])).toBeUndefined();
	});

	it("does not take a one-character name for a match inside a long one", () => {
		expect(
			nearest("utterly-unrelated-name", ["-", "+", "car"]),
		).toBeUndefined();
	});

	it("matches a name the candidate was prefixed onto, not one buried in it", () => {
		expect(nearest("report-the-thing", ["or", "the", "re"])).toBeUndefined();
		expect(nearest("click", ["browser_click", "snapshot"])).toBe(
			"browser_click",
		);
	});

	it("matches unqualified names against unqualified candidates", () => {
		expect(nearest("lenght", ["length", "last", "list"])).toBe("length");
	});
});
