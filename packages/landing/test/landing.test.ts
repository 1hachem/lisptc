import { describe, expect, it } from "vitest";
import { parseLandingPage, sectionTypes } from "../src/landing.ts";

const page = {
	title: "CAD automations",
	theme: { base: "gruvbox-dark", accent: "#d65d0e", font: "geist" },
	sections: [
		{
			type: "hero",
			layout: "split",
			title: "CAD automations that learn your shop",
			cta: { label: "Start free", flow: "shop-owner" },
		},
		{
			type: "features",
			items: [
				{
					icon: "cube",
					title: "Parametric parts",
					body: "Driven by your rules.",
				},
			],
		},
		{
			type: "pricing",
			plans: [
				{ name: "Shop", price: "$40", period: "month", features: ["5 seats"] },
			],
		},
		{
			type: "faq",
			items: [{ question: "Which CAD?", answer: "FreeCAD first." }],
		},
		{ type: "cta", title: "Ready?", cta: { label: "Start" } },
	],
};

describe("landing page schema", () => {
	it("accepts a page made of the known sections", () => {
		const result = parseLandingPage(page);
		expect(result.ok).toBe(true);
	});

	it("names every section type it accepts", () => {
		expect(sectionTypes).toEqual([
			"hero",
			"features",
			"steps",
			"pricing",
			"testimonials",
			"faq",
			"cta",
			"vertical-directory",
		]);
	});

	it("refuses an unknown section type", () => {
		const result = parseLandingPage({
			...page,
			sections: [{ type: "carousel", title: "x" }],
		});
		expect(result.ok).toBe(false);
	});

	it("refuses a misspelt key, so a typo is reported rather than dropped", () => {
		const result = parseLandingPage({
			...page,
			sections: [{ type: "hero", titel: "x", title: "y" }],
		});
		expect(result).toMatchObject({ ok: false });
		if (!result.ok) expect(result.problems.join("\n")).toMatch(/titel/);
	});

	it("says where a problem is, by path", () => {
		const result = parseLandingPage({ ...page, theme: { accent: "orange" } });
		expect(result).toEqual({
			ok: false,
			problems: ["theme accent: a colour is #rrggbb"],
		});
	});

	it("allows only https links", () => {
		const result = parseLandingPage({
			...page,
			sections: [
				{
					type: "hero",
					title: "x",
					secondary: { label: "docs", href: "javascript:alert(1)" },
				},
			],
		});
		expect(result.ok).toBe(false);
	});

	it("needs at least one section", () => {
		expect(parseLandingPage({ title: "x", sections: [] }).ok).toBe(false);
	});
});
