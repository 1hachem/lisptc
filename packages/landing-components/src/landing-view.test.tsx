import type { LandingPage } from "@repo/landing";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingView, landingTheme } from "./landing-view.tsx";

const page: LandingPage = {
	title: "CAD automations",
	theme: { base: "gruvbox-light", accent: "#d65d0e", font: "geist" },
	sections: [
		{
			type: "hero",
			title: "CAD that learns your shop",
			cta: { label: "Start free", flow: "shop-owner" },
		},
		{
			type: "features",
			items: [
				{ icon: "cube", title: "Parts", body: "Parametric." },
				{ icon: "no-such-icon", title: "Rules", body: "Yours." },
			],
		},
		{ type: "vertical-directory", title: "Experts" },
	],
};

const start = (cta: { flow?: string }) =>
	`/start/cad${cta.flow === undefined ? "" : `?flow=${cta.flow}`}`;

describe("LandingView", () => {
	it("draws every section of the page", () => {
		const html = renderToStaticMarkup(
			<LandingView page={page} start={start} />,
		);
		expect(html).toContain("CAD that learns your shop");
		expect(html).toContain("Parametric.");
		expect(html).toContain("Yours.");
	});

	it("points a call to action where the app says it starts", () => {
		const html = renderToStaticMarkup(
			<LandingView page={page} start={start} />,
		);
		expect(html).toContain('href="/start/cad?flow=shop-owner"');
	});

	it("scopes the page's theme, font and accent to its own root", () => {
		const html = renderToStaticMarkup(
			<LandingView page={page} start={start} />,
		);
		expect(html).toMatch(/<main[^>]*data-theme="gruvbox-light"/);
		expect(html).toMatch(/<main[^>]*data-font="geist"/);
		expect(html).toContain("--brand:#d65d0e");
	});

	it("ignores a theme or font the design system does not offer", () => {
		const theme = landingTheme({
			...page,
			theme: { base: "neon", font: "comic" },
		});
		expect(theme.theme).toBeUndefined();
		expect(theme.font).toBeUndefined();
	});

	it("leaves out a directory with no verticals, and lists the ones it is given", () => {
		expect(
			renderToStaticMarkup(<LandingView page={page} start={start} />),
		).not.toContain("Experts");
		const html = renderToStaticMarkup(
			<LandingView
				page={page}
				start={start}
				verticals={[{ name: "CAD", href: "/site/cad" }]}
			/>,
		);
		expect(html).toContain("Experts");
		expect(html).toContain('href="/site/cad"');
	});
});
