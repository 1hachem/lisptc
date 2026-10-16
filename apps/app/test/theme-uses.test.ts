import type { ThemeDef } from "@repo/ui";
import { describe, expect, it } from "vitest";
import { mostUsedThemes, recordThemeUse } from "../src/lib/theme-uses.ts";

const theme = (id: string): ThemeDef => ({
	id,
	name: id,
	scheme: "dark",
});

const themes = ["a", "b", "c", "d"].map(theme);
const ids = (list: ThemeDef[]) => list.map((t) => t.id);

describe("counting theme picks", () => {
	it("adds one to the theme picked and keeps the others", () => {
		expect(recordThemeUse(recordThemeUse({ a: 1 }, "b"), "b")).toEqual({
			a: 1,
			b: 2,
		});
	});
});

describe("ranking themes by use", () => {
	it("keeps the declared order when nothing was picked", () => {
		expect(ids(mostUsedThemes(themes, {}, 6))).toEqual(["a", "b", "c", "d"]);
	});

	it("puts the most picked first and breaks ties by declared order", () => {
		expect(ids(mostUsedThemes(themes, { c: 3, d: 1, b: 1 }, 6))).toEqual([
			"c",
			"b",
			"d",
			"a",
		]);
	});

	it("stops at the limit", () => {
		expect(ids(mostUsedThemes(themes, { d: 2 }, 2))).toEqual(["d", "a"]);
	});
});
