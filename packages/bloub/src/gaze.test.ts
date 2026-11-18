// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BloubBotProps } from "./BloubBot";
import { BotEngine } from "./bot/engine";
import { EXPRESSION_BY_ID, EXPRESSIONS } from "./bot/expressions";
import { SHAPE_BY_ID } from "./bot/skins";
import {
	type Aim,
	HUMEURS,
	lookTarget,
	TOUR_TIME,
	TURN,
	TURN_TIME,
	tourLook,
	YAW_MAX,
} from "./gaze";
import { animer, dessiner } from "./test-helpers";

const cercle = () => SHAPE_BY_ID.get("cercle")!.radii;

const vise = (o: Partial<Aim> = {}): Aim => ({
	nx: 0,
	ny: 0,
	tour: 1,
	pointer: true,
	...o,
});

async function image(props: BloubBotProps, t = 1) {
	const bot = await dessiner({ ...props, frozenAt: 0 });
	const out = await bot.a(t);
	await bot.demonter();
	return out;
}

async function suivant(
	pointeur: [number, number] | null,
	secondes: number,
	props: BloubBotProps = {},
) {
	const bot = await animer({ follow: true, expression: "neutre", ...props });
	if (pointeur) bot.pointer(...pointeur);
	const images = [];
	for (let t = 0; t < secondes; t += 0.05) images.push(await bot.avancer(0.05));
	await bot.demonter();
	vi.unstubAllGlobals();
	return images;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("le bot suit le pointeur", () => {
	it("tourne sur lui-meme, les yeux passant derriere la boule, puis regarde a gauche", async () => {
		const tour = await suivant([50, 50], TURN_TIME + 0.4);
		const repos = await image({ expression: "neutre" });
		expect(tour.some((i) => i.yeux.length === 0)).toBe(true);
		const fin = tour.at(-1)!;
		expect(fin.yeux).toHaveLength(2);
		expect(fin.yeux[0]!.x).toBeLessThan(repos.yeux[0]!.x);
	}, 30_000);

	it("suit le curseur dans le bon sens sur les deux axes", async () => {
		const fin = async (x: number, y: number) =>
			(await suivant([x, y], TURN_TIME + 0.4)).at(-1)!.yeux[0]!;
		expect((await fin(1000, 50)).x).toBeGreaterThan((await fin(-1000, 50)).x);
		expect((await fin(50, -1000)).y).toBeLessThan((await fin(50, 1000)).y);
	}, 60_000);
});

describe("les deux yeux restent visibles", () => {
	it("laisse la pose commander tant que l arrivee n a pas commence", async () => {
		const cible = lookTarget(vise({ tour: 0, pointer: false }));
		expect(
			(await image({ expression: "neutre", gaze: () => cible })).yeux,
		).toEqual((await image({ expression: "neutre" })).yeux);
	});

	it("sur les 16 expressions, aux quatre coins de l ecran", async () => {
		for (const e of EXPRESSIONS) {
			for (const nx of [-1, 0, 1]) {
				for (const ny of [-1, 0, 1]) {
					const cible = lookTarget(vise({ nx, ny }));
					const { yeux } = await image({
						expression: e.id,
						gaze: () => cible,
					});
					expect(yeux, `${e.id} nx=${nx} ny=${ny}`).toHaveLength(2);
					for (const oeil of yeux) {
						expect(oeil.alpha, `${e.id} nx=${nx} ny=${ny}`).toBeGreaterThan(
							0.5,
						);
					}
				}
			}
		}
	}, 60_000);

	it("garde de la marge : le suivi ne va pas jusqu au point de rupture", () => {
		const moteur = new BotEngine(
			100,
			"idle",
			cercle(),
			EXPRESSION_BY_ID.get("neutre")!,
		);
		moteur.setLook(
			{ yaw: -(TURN + YAW_MAX) - 25, pitch: 0, mix: 1, spin: 0, wander: 0 },
			0,
		);
		expect(moteur.sample(1).eyes).toHaveLength(2);
	});
});

describe("tour d arrivee sur le site", () => {
	it("part du visage au repos, le cache a mi-tour et y revient, quelle que soit l expression", async () => {
		for (const e of EXPRESSIONS) {
			const repos = (await image({ expression: e.id })).yeux;
			const a = async (k: number) =>
				(await image({ expression: e.id, gaze: () => tourLook(k * TOUR_TIME) }))
					.yeux;
			expect(await a(0), e.id).toEqual(repos);
			expect(await a(0.5), e.id).toHaveLength(0);
			expect(await a(1), e.id).toEqual(repos);
		}
	}, 30_000);
});

describe("stabilite du regard entre expressions", () => {
	it("aligne a la meme hauteur les yeux d humeurs qui, sans pilotage, n y sont pas", async () => {
		const hauteur = async (id: string, gaze: BloubBotProps["gaze"]) =>
			(await image({ expression: id, gaze })).yeux[0]!.y;
		const cible = lookTarget(vise());
		const pilotees: number[] = [];
		const libres: number[] = [];
		for (const id of HUMEURS) {
			pilotees.push(await hauteur(id, () => cible));
			libres.push(await hauteur(id, null));
		}
		const ecart = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
		expect(ecart(pilotees)).toBeLessThan(4);
		expect(ecart(libres)).toBeGreaterThan(10);
	});
});
