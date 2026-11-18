// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { BloubBotProps } from "../BloubBot";
import { dedans, dessiner, type Image } from "../test-helpers";
import { BotEngine, type Look } from "./engine";
import { EXPRESSIONS } from "./expressions";
import { SHAPES } from "./skins";
import { STATES, type StateId } from "./states";

const regard = (o: Partial<Look>): Look => ({
	yaw: 0,
	pitch: 0,
	mix: 1,
	spin: 0,
	wander: 0,
	...o,
});

async function image(props: BloubBotProps, t: number) {
	const bot = await dessiner({ ...props, frozenAt: 0 });
	const out = await bot.a(t);
	await bot.demonter();
	return out;
}

async function regardant(look: Look, t = 1, props: BloubBotProps = {}) {
	const fixe = () => look;
	return image({ ...props, gaze: fixe }, t);
}

const EMPREINTES: Array<[StateId, number, number, number, number]> = [
	["idle", 0.5, 2.0, 2.0, 0.05],
	["egg", 0.9, 1.653, 2.0, 0.06],
	["hexagon", 0.9, 1.82, 2.01, 0.07],
	["exclaim", 0.9, 0.263, 0.842, 0.03],
	["alert", 0.8, 0.421, 0.753, 0.04],
	["sleep", 0.6, 0.317, 0.317, 0.03],
	["comet", 1.0, 0.258, 0.258, 0.03],
];

describe("silhouettes", () => {
	for (const [id, t, w, h, tol] of EMPREINTES) {
		it(`"${id}" a l empreinte mesuree sur la video`, async () => {
			const { largeur, hauteur } = await image({ state: id }, t);
			expect(Math.abs(largeur / 100 - w)).toBeLessThan(tol);
			expect(Math.abs(hauteur / 100 - h)).toBeLessThan(tol);
		});
	}

	it("le triangle est plus large que haut", async () => {
		const { largeur, hauteur } = await image({ state: "play" }, 0.9);
		expect(largeur).toBeGreaterThan(hauteur);
		expect(Math.abs(largeur / 100 - 1.99)).toBeLessThan(0.08);
	});
});

describe("dessin dans le temps", () => {
	const scenarios: Array<{
		nom: string;
		lire: () => Promise<(t: number) => Promise<Image>>;
		t: number;
	}> = [
		{
			nom: "au repos",
			t: 1.3,
			lire: async () => (await dessiner({ state: "orbit", frozenAt: 0 })).a,
		},
		{
			nom: "pendant un fondu entre etats",
			t: 1.2,
			lire: async () =>
				(
					await dessiner({
						frozenAt: 0,
						cycle: [
							{ state: "idle", duration: 1 },
							{ state: "egg", duration: 3 },
						],
					})
				).parcourir,
		},
		{
			nom: "pendant un morph de forme",
			t: 0.1,
			lire: async () => {
				const bot = await dessiner({ shape: "cercle", frozenAt: 0 });
				await bot.rendre({ shape: "capsule" });
				return bot.a;
			},
		},
		{
			nom: "pendant un morph d expression",
			t: 0.12,
			lire: async () => {
				const bot = await dessiner({ expression: "neutre", frozenAt: 0 });
				await bot.rendre({ expression: "colere" });
				return bot.a;
			},
		},
		{
			nom: "pendant le rattrapage du regard",
			t: 0.1,
			lire: async () => {
				const fixe = () => regard({ yaw: -18, pitch: -8 });
				const bot = await dessiner({ gaze: fixe, frozenAt: 0 });
				await bot.rendre({ gaze: null });
				return bot.a;
			},
		},
		{
			nom: "apres un retour en arriere dans le cycle",
			t: 0.3,
			lire: async () => {
				const bot = await dessiner({
					frozenAt: 0,
					cycle: [
						{ state: "orbit", duration: 2 },
						{ state: "idle", duration: 2 },
					],
				});
				await bot.parcourir(3);
				return bot.parcourir;
			},
		},
	];

	for (const { nom, lire, t } of scenarios) {
		it(`redonne la meme image a la meme date, ${nom}`, async () => {
			const a = await lire();
			const premiere = (await a(t)).html;
			await a(t + 1.7);
			expect((await a(t)).html).toBe(premiere);
		});
	}

	it("anime vraiment : la forme evolue entre deux dates", async () => {
		const bot = await dessiner({ state: "thinking", frozenAt: 0 });
		const corps: string[] = [];
		for (const t of [0.1, 0.4, 0.8, 1.2]) {
			corps.push(JSON.stringify((await bot.a(t)).corps));
		}
		expect(new Set(corps).size).toBe(corps.length);
		await bot.demonter();
	});

	it("interpole la silhouette pendant une transition, sans saut", async () => {
		const bot = await dessiner({
			frozenAt: 0,
			cycle: [
				{ state: "idle", duration: 1 },
				{ state: "egg", duration: 3 },
			],
		});
		const largeurs: number[] = [];
		for (const t of [1, 1.1, 1.2, 1.3, 1.4]) {
			largeurs.push((await bot.parcourir(t)).largeur / 100);
		}
		for (let i = 1; i < largeurs.length; i++) {
			expect(largeurs[i]!).toBeLessThan(largeurs[i - 1]!);
		}
		expect(largeurs[0]!).toBeCloseTo(2, 1);
		expect((await bot.parcourir(2)).largeur / 100).toBeCloseTo(1.65, 1);
		await bot.demonter();
	});

	it("ne dessine jamais le corps hors du cadre, quels que soient l etat et la forme", async () => {
		const cas: BloubBotProps[] = [
			...STATES.map((s) => ({ state: s.id })),
			...SHAPES.map((f) => ({ shape: f.id })),
		];
		for (const props of cas) {
			const bot = await dessiner({ ...props, frozenAt: 0 });
			for (const t of [0.2, 0.9, 1.8, 3]) {
				const { corps, cadre } = await bot.a(t);
				expect(corps.length).toBeGreaterThan(2);
				for (const { x, y } of corps) {
					expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
					expect(Math.abs(x), JSON.stringify(props)).toBeLessThan(cadre);
					expect(Math.abs(y), JSON.stringify(props)).toBeLessThan(cadre);
				}
			}
			await bot.demonter();
		}
	}, 60_000);
});

describe("forme personnalisee", () => {
	it("redessine le bot au repos et laisse tels quels les etats qui dessinent leur propre forme", async () => {
		expect((await image({ shape: "goutte" }, 1)).corps).not.toEqual(
			(await image({}, 1)).corps,
		);
		for (const state of [
			"exclaim",
			"alert",
			"sleep",
			"egg",
			"hexagon",
		] as const) {
			for (const forme of SHAPES) {
				const habille = await image({ state, shape: forme.id }, 1);
				const nu = await image({ state }, 1);
				expect(habille.corps, `${state}/${forme.id}`).toEqual(nu.corps);
				expect(habille.yeux, `${state}/${forme.id}`).toEqual(nu.yeux);
			}
		}
	}, 30_000);

	it("morphe vers la nouvelle forme au lieu de sauter", async () => {
		const bot = await dessiner({ shape: "cercle", frozenAt: 0 });
		expect((await bot.a(0)).hauteur / 100).toBeCloseTo(2, 1);
		await bot.rendre({ shape: "capsule" });
		const etapes: number[] = [];
		for (const t of [0.06, 0.14, 0.26]) {
			etapes.push((await bot.a(t)).hauteur / 100);
		}
		for (let i = 1; i < etapes.length; i++) {
			expect(etapes[i]!).toBeLessThan(etapes[i - 1]!);
		}
		expect(etapes[0]!).toBeLessThan(2);
		expect(etapes[etapes.length - 1]!).toBeGreaterThan(1.24);
		expect(
			(await bot.a(BotEngine.SHAPE_MORPH + 0.05)).hauteur / 100,
		).toBeCloseTo(1.24, 1);
		await bot.demonter();
	});

	it("garde le centre des yeux dans la silhouette, pour chaque forme et chaque expression", async () => {
		for (const forme of SHAPES) {
			const bot = await dessiner({ shape: forme.id, frozenAt: 1 });
			for (const expr of EXPRESSIONS) {
				const { corps, yeux } = await bot.rendre({ expression: expr.id });
				expect(yeux, `${forme.id}/${expr.id}`).toHaveLength(2);
				for (const oeil of yeux) {
					expect(dedans(corps, oeil), `${forme.id}/${expr.id}`).toBe(true);
				}
			}
			await bot.demonter();
		}
	}, 60_000);
});

describe("etats", () => {
	it("montre le visage sur les etats a visage, le cache sur les autres", async () => {
		for (const state of [
			"idle",
			"wink",
			"wide",
			"notify",
			"egg",
			"hexagon",
		] as const)
			expect((await image({ state }, 0.9)).yeux, state).toHaveLength(2);
		for (const state of ["thinking", "alert", "exclaim", "sleep"] as const)
			expect((await image({ state }, 0.9)).yeux, state).toHaveLength(0);
	}, 30_000);

	it("creuse une encoche autour de la pastille de notification", async () => {
		const { trous, pastilles } = await image({ state: "notify" }, 1);
		expect(trous).toHaveLength(1);
		const encoche = trous[0]!;
		const pastille = pastilles.find(
			(p) => Math.hypot(p.x - encoche.x, p.y - encoche.y) < 1e-6,
		)!;
		expect((encoche.r - pastille.r) / 100).toBeCloseTo(0.054, 2);
		expect(Math.hypot(pastille.x, pastille.y) / 100).toBeCloseTo(1.003, 1);
	});

	it("trace les anneaux devant ET derriere le corps", async () => {
		const { anneaux } = await image({ state: "orbit" }, 1.4);
		expect(anneaux.derriere).toBeGreaterThan(0);
		expect(anneaux.devant).toBeGreaterThan(0);
		expect(anneaux.derriere + anneaux.devant).toBeGreaterThan(3);
	});

	it("fait converger les particules vers le centre pendant l eclatement", async () => {
		const bot = await dessiner({ state: "burst", frozenAt: 0 });
		const rayon = async (t: number) => {
			const { particules } = await bot.a(t);
			const d = particules[0];
			return d ? Math.hypot(d.x, d.y) : 0;
		};
		const tot = await rayon(0.15);
		const tard = await rayon(0.45);
		expect(tot).toBeGreaterThan(tard);
		expect(tard).toBeGreaterThan(0);
		await bot.demonter();
	});
});

describe("regard pilote", () => {
	it("porte le regard vers le lacet vise", async () => {
		const droite = await regardant(regard({ yaw: 45 }));
		const gauche = await regardant(regard({ yaw: -45 }));
		expect(droite.yeux[0]!.x).toBeGreaterThan(gauche.yeux[0]!.x + 40);
	});

	it("remplace le lacet de l expression au lieu de s y ajouter", async () => {
		const a = await image({ expression: "curieux" }, 1);
		const b = await image({ expression: "blase" }, 1);
		expect(Math.abs(a.yeux[0]!.x - b.yeux[0]!.x)).toBeGreaterThan(40);
		const vise = regard({ yaw: -26 });
		const va = await regardant(vise, 1, { expression: "curieux" });
		const vb = await regardant(vise, 1, { expression: "blase" });
		expect(Math.abs(va.yeux[0]!.x - vb.yeux[0]!.x)).toBeLessThan(1);
	});

	it("parcourt le tour demande sans changer le point d arrivee", async () => {
		const direct = await regardant(regard({ yaw: -26 }));
		const tourne = await regardant(regard({ yaw: -26, spin: 360 }));
		expect(tourne.yeux).toEqual(direct.yeux);
		expect(
			(await regardant(regard({ yaw: -26, spin: 180 }))).yeux,
		).toHaveLength(0);
	});

	it("fait passer un oeil derriere la boule quand la tete tourne fort", async () => {
		expect((await regardant(regard({ yaw: 80 }))).yeux.length).toBeLessThan(2);
	});

	async function amplitude(look: Look | null) {
		const bot = await dessiner({
			frozenAt: 0,
			gaze: look ? () => look : null,
		});
		const xs: number[] = [];
		for (let t = 1; t <= 8; t += 0.25) xs.push((await bot.a(t)).yeux[0]!.x);
		await bot.demonter();
		return { debut: xs[0]!, ecart: Math.max(...xs) - Math.min(...xs) };
	}

	it("eteint la derive quand le pointeur commande, la garde sinon", async () => {
		const tenu = await amplitude(regard({ yaw: -10 }));
		const libre = await amplitude(null);
		expect(tenu.ecart).toBeLessThan(2);
		expect(libre.ecart).toBeGreaterThan(4);
		expect(libre.ecart).toBeGreaterThan(5 * tenu.ecart);
	}, 30_000);

	it("garde une tete tournee vivante quand aucun pointeur ne la commande", async () => {
		const sansPointeur = await amplitude(
			regard({ yaw: -26, pitch: 10, wander: 1 }),
		);
		const avecPointeur = await amplitude(regard({ yaw: -26, pitch: 10 }));
		expect(sansPointeur.debut).toBeLessThan(0);
		expect(avecPointeur.debut).toBeLessThan(0);
		expect(sansPointeur.ecart).toBeGreaterThan(5 * avecPointeur.ecart);
	}, 30_000);

	it("revient au regard de l etat quand la cible est relachee", async () => {
		const fixe = () => regard({ yaw: -20, pitch: -10 });
		const bot = await dessiner({ gaze: fixe, frozenAt: 0 });
		await bot.rendre({ gaze: null });
		const fini = BotEngine.LOOK_MORPH + 0.05;
		const nu = await dessiner({ frozenAt: 0 });
		expect((await bot.a(0.05)).yeux[0]!.x).not.toBeCloseTo(
			(await nu.a(0.05)).yeux[0]!.x,
			1,
		);
		expect((await bot.a(fini)).yeux).toEqual((await nu.a(fini)).yeux);
		await bot.demonter();
		await nu.demonter();
	});

	it("ignore une cible non finie plutot que de s en souvenir", async () => {
		const sain = await image({}, 1);
		expect(
			(await regardant(regard({ yaw: Number.NaN, pitch: 10 }))).yeux,
		).toEqual(sain.yeux);
	});
});

describe("retour en arriere dans le cycle", () => {
	it("montre le bloc vise comme joue depuis son debut, sans fondre depuis le suivant", async () => {
		const cycle = [
			{ state: "egg" as const, duration: 2 },
			{ state: "idle" as const, duration: 2 },
		];
		const recule = await dessiner({ frozenAt: 0, cycle });
		await recule.parcourir(3);
		const direct = await dessiner({ state: "egg", frozenAt: 0, cycle });
		expect((await recule.parcourir(0.2)).corps).toEqual(
			(await direct.parcourir(0.2)).corps,
		);
		await recule.demonter();
		await direct.demonter();
	});
});

describe("changement d etat pendant un fondu", () => {
	const IMAGE = 1 / 60;

	async function sautApres(cycle: BloubBotProps["cycle"], at: number) {
		const bot = await dessiner({ frozenAt: 0, cycle });
		const distances: Array<{ t: number; d: number[] }> = [];
		for (let t = 0; t <= at + 4 * IMAGE; t += IMAGE) {
			const { yeux } = await bot.parcourir(t);
			distances.push({ t, d: yeux.map((y) => Math.hypot(y.x, y.y)) });
		}
		await bot.demonter();
		let pire = 0;
		for (let k = 1; k < distances.length; k++) {
			const a = distances[k - 1]!;
			const b = distances[k]!;
			if (a.d.length !== b.d.length || b.t <= at || b.t > at + 2.5 * IMAGE)
				continue;
			pire = Math.max(pire, ...a.d.map((v, j) => Math.abs(v - b.d[j]!)));
		}
		return pire;
	}

	const NORMAL = 14;

	it("ne saute pas plus qu un changement espace", async () => {
		const espace = await sautApres(
			[
				{ state: "idle", duration: 0.5 },
				{ state: "wide", duration: 1.5 },
				{ state: "idle", duration: 3 },
			],
			2,
		);
		expect(espace).toBeLessThan(NORMAL);
		expect(
			await sautApres(
				[
					{ state: "idle", duration: 0.5 },
					{ state: "wide", duration: 0.1 },
					{ state: "idle", duration: 3 },
				],
				0.6,
			),
		).toBeLessThanOrEqual(espace);
	}, 30_000);

	it("tient sur des changements enchaines", async () => {
		const cycle = [
			{ state: "idle" as const, duration: 0.5 },
			{ state: "wide" as const, duration: 0.05 },
			{ state: "idle" as const, duration: 0.05 },
			{ state: "egg" as const, duration: 0.05 },
			{ state: "orbit" as const, duration: 0.05 },
			{ state: "notify" as const, duration: 3 },
		];
		for (const at of [0.55, 0.6, 0.65, 0.7]) {
			expect(await sautApres(cycle, at), `changement a ${at}s`).toBeLessThan(
				NORMAL,
			);
		}
	}, 30_000);

	it("continue d animer le corps apres des changements espaces", async () => {
		const bot = await dessiner({
			frozenAt: 0,
			cycle: [
				{ state: "idle", duration: 1 },
				{ state: "thinking", duration: 1 },
				{ state: "wink", duration: 1 },
				{ state: "alert", duration: 2 },
			],
		});
		const corps: string[] = [];
		for (let t = 0; t < 3.8; t += 0.1) {
			corps.push(JSON.stringify((await bot.parcourir(t)).corps));
		}
		for (let t = 3.8; t < 4; t += IMAGE) {
			corps.push(JSON.stringify((await bot.parcourir(t)).corps));
		}
		expect(corps.every((c) => c.length > 2)).toBe(true);
		expect(new Set(corps.slice(-12)).size).toBeGreaterThan(1);
		await bot.demonter();
	});
});
