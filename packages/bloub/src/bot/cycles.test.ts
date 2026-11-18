// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { dessiner } from "../test-helpers";
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

	it("ne casse pas sur un cycle vide", async () => {
		const bot = await dessiner({ frozenAt: 0, cycle: [] });
		const avant = bot.image().html;
		expect((await bot.parcourir(3)).html).toBe(avant);
		await bot.demonter();
	});
});
