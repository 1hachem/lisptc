// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { BloubBotProps } from "../BloubBot";
import { dessiner } from "../test-helpers";
import { BotEngine } from "./engine";

async function image(props: BloubBotProps, t = 1) {
	const bot = await dessiner({ ...props, frozenAt: t });
	const out = bot.image();
	await bot.demonter();
	return out;
}

describe("expressions", () => {
	it("incline la colere et la tristesse en miroir, et dans des sens opposes", async () => {
		const colere = (await image({ expression: "colere" })).yeux.map(
			(o) => o.axe,
		);
		const triste = (await image({ expression: "triste" })).yeux.map(
			(o) => o.axe,
		);
		expect(Math.sign(colere[0]!)).toBe(-Math.sign(colere[1]!));
		expect(Math.sign(triste[0]!)).toBe(-Math.sign(triste[1]!));
		expect(Math.sign(colere[0]!)).toBe(-Math.sign(triste[0]!));
	});

	it("glisse vers la nouvelle expression au lieu de sauter", async () => {
		const bot = await dessiner({ expression: "neutre", frozenAt: 0 });
		const depart = (await bot.a(0.02)).yeux[0]!.forme;
		await bot.rendre({ expression: "effraye", frozenAt: 0 });
		const tot = (await bot.a(0.02)).yeux[0]!.forme;
		const fin = BotEngine.SHAPE_MORPH + 0.05;
		const arrive = (await image({ expression: "effraye" }, fin)).yeux[0]!.forme;
		expect(tot).not.toBe(depart);
		expect(tot).not.toBe(arrive);
		expect((await bot.a(fin)).yeux[0]!.forme).toBe(arrive);
		await bot.demonter();
	});

	it("n applique l expression qu a l etat de repos", async () => {
		expect(
			(await image({ state: "wink", expression: "effraye" })).yeux,
		).toEqual((await image({ state: "wink", expression: "neutre" })).yeux);
		expect(
			(await image({ state: "idle", expression: "effraye" })).yeux,
		).not.toEqual((await image({ state: "idle", expression: "neutre" })).yeux);
	});
});
