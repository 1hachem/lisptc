import { describe, expect, it } from "vitest";
import {
	checkedAfter,
	eachOf,
	searched,
	toggledAll,
} from "../src/lib/file-list.ts";

const order = ["a.md", "b.md", "c.md", "d.md"];

describe("searched", () => {
	it("matches a name in any case and keeps everything on a blank query", () => {
		const files = [{ name: "Report.PDF" }, { name: "notes.md" }];
		expect(searched(files, " report ")).toEqual([{ name: "Report.PDF" }]);
		expect(searched(files, "  ")).toBe(files);
		expect(searched(undefined, "x")).toBeUndefined();
	});
});

describe("checkedAfter", () => {
	it("toggles one name without a range", () => {
		expect([...checkedAfter(order, new Set(), null, "b.md", false)]).toEqual([
			"b.md",
		]);
		expect([
			...checkedAfter(order, new Set(["b.md"]), "b.md", "b.md", false),
		]).toEqual([]);
	});

	it("checks every name between the anchor and a shift-clicked one", () => {
		const next = checkedAfter(order, new Set(["d.md"]), "d.md", "b.md", true);
		expect([...next].sort()).toEqual(["b.md", "c.md", "d.md"]);
	});

	it("falls back to a toggle when the anchor is gone", () => {
		const next = checkedAfter(order, new Set(), "gone.md", "c.md", true);
		expect([...next]).toEqual(["c.md"]);
	});
});

describe("toggledAll", () => {
	it("checks a whole group, and unchecks it once every name in it is checked", () => {
		const some = toggledAll(new Set(["a.md", "d.md"]), ["a.md", "b.md"]);
		expect([...some].sort()).toEqual(["a.md", "b.md", "d.md"]);
		expect([...toggledAll(some, ["a.md", "b.md"])]).toEqual(["d.md"]);
	});
});

describe("eachOf", () => {
	it("runs every name and names the ones that failed", async () => {
		const ran: string[] = [];
		await expect(
			eachOf(order, async (name) => {
				ran.push(name);
				if (name === "c.md") throw new Error("refused");
			}),
		).rejects.toThrow("1 of 4 failed. c.md: refused");
		expect(ran).toEqual(order);
	});
});
