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

	it("refuses, naming the theme, when it is already dark or has no dark variant", () => {
		for (const id of ["gruvbox-dark", "paper"]) {
			const refused = schemeVariant(THEMES, named(id), "dark");
			expect(typeof refused).toBe("string");
			expect(refused).toContain(named(id).name);
		}
	});
});

describe("the light variant of a theme", () => {
	it("is the theme of the same name with the light scheme", () => {
		expect(schemeVariant(THEMES, named("gruvbox-dark"), "light")).toBe(
			named("gruvbox-light"),
		);
	});

	it("refuses, naming the theme, when it is already light or has no light variant", () => {
		for (const id of ["gruvbox-light", "borland"]) {
			const refused = schemeVariant(THEMES, named(id), "light");
			expect(typeof refused).toBe("string");
			expect(refused).toContain(named(id).name);
		}
	});
});
