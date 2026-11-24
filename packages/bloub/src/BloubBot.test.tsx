// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BloubBot } from "./BloubBot";
import { BotEngine } from "./bot/engine";
import { DEFAULT_EXPRESSION, EXPRESSION_BY_ID } from "./bot/expressions";
import { RAYON } from "./bot/repere";
import { DEFAULT_SHAPE, SHAPE_BY_ID } from "./bot/skins";
import type { StateId } from "./bot/states";
import { animer, dessiner } from "./test-helpers";

function moteurTemoin(state: StateId = "idle") {
	return new BotEngine(
		RAYON,
		state,
		SHAPE_BY_ID.get(DEFAULT_SHAPE)?.radii ?? null,
		EXPRESSION_BY_ID.get(DEFAULT_EXPRESSION) ?? null,
	);
}

async function monter(node: React.ReactNode) {
	const hote = document.createElement("div");
	document.body.append(hote);
	const root = createRoot(hote);
	await act(async () => {
		root.render(node);
	});
	return {
		svg: () => hote.querySelector("svg")!,
		rendre: async (suivant: React.ReactNode) => {
			await act(async () => {
				root.render(suivant);
			});
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("BloubBot", () => {
	it("redessine quand `frozenAt` bouge", async () => {
		const { svg, rendre } = await monter(<BloubBot frozenAt={0} />);
		const premier = svg().querySelector("mask > path")?.getAttribute("d");
		await rendre(<BloubBot frozenAt={0.8} />);
		const attendu = moteurTemoin().sample(0.8);
		expect(svg().querySelector("mask > path")?.getAttribute("d")).toBe(
			attendu.bodyPath,
		);
		expect(attendu.bodyPath).not.toBe(premier);
	});

	it("montre l etat pose a l arret, sans jouer le cycle par-dessus au montage", async () => {
		const bot = await animer({ state: "thinking" });
		const image = await bot.avancer(1.5);
		expect(image.yeux).toHaveLength(0);
		await bot.demonter();
	});

	it("grossit les yeux sur place quand l hote le demande", async () => {
		const bot = await dessiner({ frozenAt: 0 });
		const avant = bot.image().yeux;
		const apres = (await bot.rendre({ eyeScale: 1.25 })).yeux;
		expect(apres).toHaveLength(avant.length);
		for (const [i, oeil] of apres.entries()) {
			expect(oeil.x).toBeCloseTo(avant[i]!.x, 5);
			expect(oeil.y).toBeCloseTo(avant[i]!.y, 5);
			expect(oeil.hauteur / avant[i]!.hauteur).toBeCloseTo(1.25, 5);
		}
		await bot.demonter();
	});
});
