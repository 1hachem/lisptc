// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { BloubBotProps } from "../BloubBot";
import { debordement, dessiner, type Point } from "../test-helpers";
import { BotEngine, type Look } from "./engine";
import { EXPRESSIONS } from "./expressions";
import { SHAPES } from "./skins";
import { STATES } from "./states";

const SANS_EXPRESSION = "aucune";
const INSTANTS = 12;
const PAS = 1 / 4;

async function pireDebordement(props: BloubBotProps) {
	const bot = await dessiner({ ...props, frozenAt: 0 });
	let pire = 0;
	for (let i = 0; i < INSTANTS; i++) {
		pire = Math.max(pire, debordement(await bot.a(i * PAS)));
	}
	await bot.demonter();
	return pire;
}

const CORPS_DE_BASE = STATES.filter((s) => s.baseBody).map((s) => s.id);
const TOUTES = [SANS_EXPRESSION, ...EXPRESSIONS.map((e) => e.id)];

describe("formes du personnalisateur", () => {
	it("aucune forme ne laisse un oeil sortir de la silhouette", async () => {
		const fautifs: string[] = [];
		for (const state of CORPS_DE_BASE) {
			for (const forme of SHAPES) {
				for (const expression of TOUTES) {
					const sortie = await pireDebordement({
						state,
						shape: forme.id,
						expression,
					});
					if (sortie > 0.05) {
						fautifs.push(
							`${state}/${forme.id}/${expression} ${sortie.toFixed(1)}`,
						);
					}
				}
			}
		}
		expect(fautifs).toEqual([]);
	}, 600_000);

	const A_REGARD_LIBRE = ["cercle", "squircle", "carre"];
	const ENVELOPPE: Look[] = [-16, 0, 16].flatMap((yaw) =>
		[-13, 0, 26].map((pitch) => ({ yaw, pitch, mix: 1, spin: 0, wander: 1 })),
	);

	it("un regard pilote tient sur les formes a regard libre", async () => {
		const fautifs: string[] = [];
		for (const shape of A_REGARD_LIBRE) {
			for (const expr of EXPRESSIONS) {
				for (const look of ENVELOPPE) {
					const sortie = await pireDebordement({
						shape,
						expression: expr.id,
						gaze: () => look,
					});
					if (sortie > 0.05) {
						fautifs.push(
							`${shape}/${expr.id}/${look.yaw}:${look.pitch} ${sortie.toFixed(1)}`,
						);
					}
				}
			}
		}
		expect(fautifs).toEqual([]);
	}, 600_000);

	it("des yeux grossis a 1.3 restent dans le carre, quel que soit le regard", async () => {
		const fautifs: string[] = [];
		for (const expr of EXPRESSIONS) {
			for (const look of ENVELOPPE) {
				const sortie = await pireDebordement({
					shape: "carre",
					expression: expr.id,
					gaze: () => look,
					eyeScale: 1.3,
				});
				if (sortie > 0.05) {
					fautifs.push(
						`${expr.id}/${look.yaw}:${look.pitch} ${sortie.toFixed(1)}`,
					);
				}
			}
		}
		expect(fautifs).toEqual([]);
	}, 600_000);

	it("choisir le cercle rend exactement la meme chose qu une forme inconnue", async () => {
		for (const state of CORPS_DE_BASE) {
			for (const expression of TOUTES) {
				const avec = await dessiner({
					state,
					expression,
					shape: "cercle",
					frozenAt: 1,
				});
				const sans = await dessiner({
					state,
					expression,
					shape: "inconnue",
					frozenAt: 1,
				});
				expect(avec.image().yeux, `${state}/${expression}`).toEqual(
					sans.image().yeux,
				);
				expect(avec.image().corps).toEqual(sans.image().corps);
				await avec.demonter();
				await sans.demonter();
			}
		}
	}, 120_000);

	it("la taille des yeux ne depend pas de la forme", async () => {
		const tailles = new Set<string>();
		for (const forme of SHAPES) {
			const bot = await dessiner({
				shape: forme.id,
				expression: SANS_EXPRESSION,
				frozenAt: 1,
			});
			tailles.add(
				bot
					.image()
					.yeux.map((y) => y.forme)
					.join("|"),
			);
			await bot.demonter();
		}
		expect(tailles.size).toBe(1);
	});

	it("la correction ne fait pas osciller les yeux", async () => {
		const pas = 1 / 60;

		const trajectoire = async (
			depart: BloubBotProps,
			arrivee: BloubBotProps,
			duree = BotEngine.SHAPE_MORPH,
		) => {
			const bot = await dessiner({ ...depart, frozenAt: 0 });
			await bot.rendre(arrivee);
			const out: Point[][] = [];
			for (let t = 0; t <= duree + pas; t += pas) {
				out.push((await bot.a(t)).yeux.map(({ x, y }) => ({ x, y })));
			}
			await bot.demonter();
			return out;
		};

		const allersRetours = (suite: Point[][]) => {
			let n = 0;
			let amplitude = 0;
			const yeux = Math.min(...suite.map((f) => f.length));
			for (let j = 0; j < yeux; j++) {
				let px = 0;
				let py = 0;
				for (let i = 1; i < suite.length; i++) {
					const dx = suite[i]![j]!.x - suite[i - 1]![j]!.x;
					const dy = suite[i]![j]!.y - suite[i - 1]![j]!.y;
					const len = Math.hypot(dx, dy);
					if (len <= 0.05) continue;
					if ((px || py) && dx * px + dy * py < 0) {
						n++;
						amplitude = Math.max(amplitude, len);
					}
					px = dx;
					py = dy;
				}
			}
			return { n, amplitude };
		};

		const nu = { expression: SANS_EXPRESSION };
		const morphDeForme = async (shape: string) =>
			allersRetours(
				await trajectoire({ ...nu, shape: "cercle" }, { ...nu, shape }),
			);
		const auRepos = async (shape: string) =>
			allersRetours(await trajectoire({ ...nu, shape }, {}, 3));
		const morphsDExpression = async (shape: string) => {
			let n = 0;
			let amplitude = 0;
			for (const expr of EXPRESSIONS) {
				const r = allersRetours(
					await trajectoire(
						{ shape, expression: EXPRESSIONS[0]!.id },
						{ expression: expr.id },
					),
				);
				n += r.n;
				amplitude = Math.max(amplitude, r.amplitude);
			}
			return { n, amplitude };
		};

		expect(
			(await morphsDExpression("cercle")).n,
			"cercle : morphs d expression",
		).toBe(0);

		const reposCercle = (await auRepos("cercle")).n;
		const morphCercle = (await morphDeForme("cercle")).n;
		for (const forme of SHAPES) {
			expect(
				(await auRepos(forme.id)).n,
				`${forme.id} : derive au repos`,
			).toBeLessThanOrEqual(reposCercle + 1);
			expect(
				(await morphDeForme(forme.id)).n,
				`morph de forme vers ${forme.id}`,
			).toBeLessThanOrEqual(morphCercle + 1);
			expect(
				(await morphsDExpression(forme.id)).amplitude,
				`${forme.id} : morphs d expression`,
			).toBeLessThan(14);
		}
	}, 600_000);
});
