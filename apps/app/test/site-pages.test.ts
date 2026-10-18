import { describe, expect, it } from "vitest";
import { builtInPage, readLandingSource } from "../src/lib/site-pages.ts";

describe("site pages", () => {
	it("serves salsal's own page, and it fits the schema", () => {
		const page = builtInPage("salsal");
		expect(page?.sections.map((section) => section.type)).toEqual([
			"hero",
			"features",
			"steps",
			"vertical-directory",
			"cta",
		]);
	});

	it("knows no other vertical yet", () => {
		expect(builtInPage("cad")).toBeUndefined();
	});

	it("reads a landing file as data and reports where it is wrong", () => {
		expect(
			readLandingSource('(:title "x" :sections ((:type :hero :titel "y")))'),
		).toMatchObject({ ok: false });
		expect(
			readLandingSource('(:title "x" :sections ((:type :hero :title "y")))'),
		).toMatchObject({ ok: true });
	});

	it("refuses a file that is not one data form", () => {
		expect(readLandingSource("(:title")).toMatchObject({ ok: false });
	});
});
