import type { ThemeDef } from "@repo/ui";
import { describe, expect, it } from "vitest";
import {
	mostUsedThemes,
	parseThemeUses,
	recordThemeUse,
	serializeThemeUses,
} from "../src/lib/theme-uses.ts";

const theme = (id: string): ThemeDef => ({
	id,
	name: id,
	scheme: "dark",
});

const themes = ["a", "b", "c", "d"].map(theme);
const ids = (list: ThemeDef[]) => list.map((t) => t.id);

describe("counting theme picks", () => {
	it("round-trips through the cookie value", () => {
		const uses = recordThemeUse(recordThemeUse({}, "b"), "b");
		expect(parseThemeUses(serializeThemeUses(uses))).toEqual({ b: 2 });
	});

	it("drops malformed pairs", () => {
		expect(parseThemeUses("a:3|b:x|:2|c:-1|d")).toEqual({ a: 3 });
		expect(parseThemeUses(undefined)).toEqual({});
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
