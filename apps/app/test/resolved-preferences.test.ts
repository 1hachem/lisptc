import { defaultFontId, defaultThemeId, fonts, themes } from "@repo/ui";
import { describe, expect, it } from "vitest";
import { fontOf, themeOf, togglesOf } from "../src/lib/resolved-preferences.ts";

describe("resolving stored preferences", () => {
	it("falls back to the defaults when nothing is stored, as for a visitor", () => {
		expect(themeOf(undefined)).toBe(defaultThemeId);
		expect(fontOf(undefined)).toBe(defaultFontId);
	});

	it("takes what is stored when the app still offers it", () => {
		const theme = themes.at(-1)?.id;
		const font = fonts.at(-1)?.id;
		expect(themeOf({ theme })).toBe(theme);
		expect(fontOf({ font })).toBe(font);
	});

	it("ignores a value the app no longer offers", () => {
		expect(themeOf({ theme: "gone" })).toBe(defaultThemeId);
		expect(fontOf({ font: "gone" })).toBe(defaultFontId);
	});

	it("reads each toggle the app offers off the store, and drops the rest", () => {
		const fields = [{ id: "lisp" }, { id: "system" }] as const;
		expect(togglesOf(fields, undefined)).toEqual({
			lisp: false,
			system: false,
		});
		expect(togglesOf(fields, { system: true, stray: true })).toEqual({
			lisp: false,
			system: true,
		});
	});
});
