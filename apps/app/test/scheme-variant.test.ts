import type { ThemeDef } from "@repo/ui";
import { describe, expect, it } from "vitest";
import { schemeVariant } from "../src/lib/theme-uses.ts";

const THEMES: ThemeDef[] = [
	{ id: "gruvbox-dark", name: "gruvbox", scheme: "dark" },
	{ id: "gruvbox-light", name: "gruvbox", scheme: "light" },
	{ id: "paper", name: "paper", scheme: "light" },
	{ id: "borland", name: "borland", scheme: "dark" },
];

function named(id: string): ThemeDef {
	const found = THEMES.find((theme) => theme.id === id);
	if (found === undefined) throw new Error(id);
	return found;
}

describe("the dark variant of a theme", () => {
	it("is the theme of the same name with the dark scheme", () => {
		expect(schemeVariant(THEMES, named("gruvbox-light"), "dark")).toBe(
			named("gruvbox-dark"),
		);
	});

	it("says so when the theme is already dark", () => {
		expect(schemeVariant(THEMES, named("gruvbox-dark"), "dark")).toBe(
			"gruvbox is already dark",
		);
	});

	it("says so when the theme has no dark variant", () => {
		expect(schemeVariant(THEMES, named("paper"), "dark")).toBe(
			"paper has no dark variant",
		);
	});
});

describe("the light variant of a theme", () => {
	it("is the theme of the same name with the light scheme", () => {
		expect(schemeVariant(THEMES, named("gruvbox-dark"), "light")).toBe(
			named("gruvbox-light"),
		);
	});

	it("says so when the theme is already light", () => {
		expect(schemeVariant(THEMES, named("gruvbox-light"), "light")).toBe(
			"gruvbox is already light",
		);
	});

	it("says so when the theme has no light variant", () => {
		expect(schemeVariant(THEMES, named("borland"), "light")).toBe(
			"borland has no light variant",
		);
	});
});
