// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { animer, dessiner } from "../test-helpers";
import { SEQUENCE, STATE_BY_ID } from "./states";

describe("cycle par defaut", () => {
	it("joue la sequence relevee sur la video, dans l ordre, chaque etat sa duree mesuree", async () => {
		const parDefaut = await dessiner({ frozenAt: 0 });
		const ecrit = await dessiner({
			frozenAt: 0,
			cycle: SEQUENCE.map((state) => ({
				state,
				duration: STATE_BY_ID.get(state)!.duration,
			})),
		});
		const fin = SEQUENCE.reduce(
			(s, id) => s + STATE_BY_ID.get(id)!.duration,
			0,
		);
		for (let t = 0; t < fin; t += 0.37) {
			const a = await parDefaut.parcourir(t);
			const b = await ecrit.parcourir(t);
			expect(a.corps, `t=${t}`).toEqual(b.corps);
			expect(a.yeux, `t=${t}`).toEqual(b.yeux);
		}
		await parDefaut.demonter();
		await ecrit.demonter();
	});
});

describe("lecture", () => {
	it("montre le bloc sous la tete de lecture, et boucle au-dela du dernier", async () => {
		const bot = await dessiner({
			frozenAt: 0,
			cycle: [
				{ state: "idle", duration: 2 },
				{ state: "egg", duration: 3 },
			],
		});
		const largeur = async (t: number) => (await bot.parcourir(t)).largeur / 100;
		expect(await largeur(1.9)).toBeCloseTo(2, 1);
		expect(await largeur(4)).toBeCloseTo(1.65, 1);
		expect(await largeur(6.9)).toBeCloseTo(2, 1);
		expect(await largeur(9)).toBeCloseTo(1.65, 1);
		await bot.demonter();
	});

	it("joue un cycle vide en gardant le bot entier a l ecran", async () => {
		const bot = await animer({ cycle: [], playing: true });
		const image = await bot.avancer(3);
		expect(image.yeux).toHaveLength(2);
		expect(image.corps.length).toBeGreaterThan(0);
		await bot.demonter();
		vi.unstubAllGlobals();
	});
});
