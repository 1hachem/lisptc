import type { ThemeDef } from "@repo/ui";
import { describe, expect, it } from "vitest";
import { darkVariant } from "../src/lib/theme-uses.ts";

const THEMES: ThemeDef[] = [
	{ id: "gruvbox-dark", name: "gruvbox", scheme: "dark" },
	{ id: "gruvbox-light", name: "gruvbox", scheme: "light" },
	{ id: "paper", name: "paper", scheme: "light" },
];

function named(id: string): ThemeDef {
	const found = THEMES.find((theme) => theme.id === id);
	if (found === undefined) throw new Error(id);
	return found;
}

describe("the dark variant of a theme", () => {
	it("is the theme of the same name with the dark scheme", () => {
		expect(darkVariant(THEMES, named("gruvbox-light"))).toBe(
			named("gruvbox-dark"),
		);
	});

	it("says so when the theme is already dark", () => {
		expect(darkVariant(THEMES, named("gruvbox-dark"))).toBe(
			"gruvbox is already dark",
		);
	});

	it("says so when the theme has no dark variant", () => {
		expect(darkVariant(THEMES, named("paper"))).toBe(
			"paper has no dark variant",
		);
	});
});
