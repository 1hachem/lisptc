import { defaultFontId, defaultThemeId } from "@repo/ui";
import { describe, expect, it } from "vitest";
import { fontOf, motionOf, themeOf } from "../src/lib/resolved-preferences.ts";

describe("resolving stored preferences", () => {
	it("ignores a value the app no longer offers", () => {
		expect(themeOf({ theme: "gone" })).toBe(defaultThemeId);
		expect(fontOf({ font: "gone" })).toBe(defaultFontId);
		expect(motionOf({ motion: "spin" })).toBe("slide");
	});
});
