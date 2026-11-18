// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { dessiner } from "../test-helpers";

describe("yeux poses sur une sphere", () => {
	it("garde la meme hauteur aux deux yeux quand la tete tourne", async () => {
		const bot = await dessiner({ expression: "neutre", frozenAt: 1 });
		const [proche, loin] = bot.image().yeux;
		expect(proche!.hauteur).toBeCloseTo(loin!.hauteur, 1);
		await bot.demonter();
	});
});
