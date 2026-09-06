import { describe, expect, it } from "vitest";
import { BotEngine } from "./bot/engine";
import {
	EXPRESSION_BY_ID,
	EXPRESSIONS,
	type ExpressionId,
} from "./bot/expressions";
import { SHAPE_BY_ID } from "./bot/skins";
import { STATE_BY_ID } from "./bot/states";
import {
	type Aim,
	HUMEURS,
	lookTarget,
	PITCH,
	SPIN,
	TOUR_TIME,
	TURN,
	tourLook,
	YAW_MAX,
} from "./gaze";

const cercle = () => SHAPE_BY_ID.get("cercle")!.radii;

const vise = (o: Partial<Aim> = {}): Aim => ({
	nx: 0,
	ny: 0,
	tour: 1,
	pointer: true,
	...o,
});

describe("cible de regard", () => {
	it("laisse la pose commander avant que l arrivee ne commence", () => {
		const cible = lookTarget(vise({ tour: 0, pointer: false }));
		expect(cible.mix).toBe(0);
		expect(cible.spin).toBe(SPIN);

		const nu = new BotEngine(
			100,
			"idle",
			cercle(),
			EXPRESSION_BY_ID.get("neutre")!,
		);
		const debut = new BotEngine(
			100,
			"idle",
			cercle(),
			EXPRESSION_BY_ID.get("neutre")!,
		);
		debut.setLook(cible, 0);
		expect(debut.sample(1).eyes[0]!.matrix).toBe(nu.sample(1).eyes[0]!.matrix);
	});

	it("tourne la tete vers la gauche, du cote du panneau", () => {
		expect(lookTarget(vise()).yaw).toBe(-TURN);
	});

	it("suit le curseur dans le bon sens sur les deux axes", () => {
		const gauche = lookTarget(vise({ nx: -1 }));
		const droite = lookTarget(vise({ nx: 1 }));
		expect(droite.yaw).toBeGreaterThan(gauche.yaw);

		expect(lookTarget(vise({ ny: -1 })).pitch).toBeGreaterThan(0);
		expect(lookTarget(vise({ ny: 1 })).pitch).toBeLessThan(0);
	});

	it("fond le tour a mesure que l arrivee se fait", () => {
		expect(lookTarget(vise({ tour: 0.5 })).spin).toBe(SPIN / 2);
		expect(lookTarget(vise({ tour: 1 })).spin).toBe(0);
	});
});

describe("les deux yeux restent visibles", () => {
	it("sur les 16 expressions, aux quatre coins de l ecran", () => {
		for (const e of EXPRESSIONS) {
			for (const nx of [-1, 0, 1]) {
				for (const ny of [-1, 0, 1]) {
					const moteur = new BotEngine(
						100,
						"idle",
						cercle(),
						EXPRESSION_BY_ID.get(e.id)!,
					);
					moteur.setLook(lookTarget(vise({ nx, ny })), 0);
					const image = moteur.sample(1);
					expect(image.eyes, `${e.id} nx=${nx} ny=${ny}`).toHaveLength(2);
					for (const oeil of image.eyes) {
						expect(oeil.alpha, `${e.id} nx=${nx} ny=${ny}`).toBeGreaterThan(
							0.5,
						);
					}
				}
			}
		}
	});

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

describe("le tour sur soi-meme", () => {
	it("fait passer les yeux derriere la boule, puis les ramene a gauche", () => {
		const image = (tour: number) => {
			const moteur = new BotEngine(
				100,
				"idle",
				cercle(),
				EXPRESSION_BY_ID.get("neutre")!,
			);
			moteur.setLook(lookTarget(vise({ tour })), 0);
			return moteur.sample(1);
		};
		expect(image(0).eyes).toHaveLength(2);
		expect(image(0.5).eyes).toHaveLength(0);
		expect(image(1).eyes).toHaveLength(2);

		const complet = image(1).eyes[0]!.matrix;
		const sansTour = new BotEngine(
			100,
			"idle",
			cercle(),
			EXPRESSION_BY_ID.get("neutre")!,
		);
		sansTour.setLook(
			{ yaw: -TURN, pitch: PITCH, mix: 1, spin: 0, wander: 0 },
			0,
		);
		expect(complet).toBe(sansTour.sample(1).eyes[0]!.matrix);
	});
});

describe("tour d arrivee sur le site", () => {
	const bot = (id: ExpressionId) =>
		new BotEngine(100, "idle", cercle(), EXPRESSION_BY_ID.get(id)!);

	it("rend la main a la pose en finissant", () => {
		expect(tourLook(TOUR_TIME).mix).toBe(0);
		expect(tourLook(TOUR_TIME + 5).spin).toBe(0);
	});

	it("repose les yeux sur l expression choisie, quelle qu elle soit", () => {
		for (const id of EXPRESSIONS.map((e) => e.id)) {
			const joue = bot(id);
			joue.setLook(tourLook(TOUR_TIME), 0);
			expect(joue.sample(1).eyes[0]!.matrix, id).toBe(
				bot(id).sample(1).eyes[0]!.matrix,
			);
		}
	});

	it("laisse le bot vivre pendant le tour", () => {
		expect(tourLook(TOUR_TIME / 2).wander).toBe(1);
	});

	it("n impose aucune direction, a aucun moment", () => {
		for (const k of [0, 0.25, 0.5, 0.75, 1]) {
			expect(tourLook(k * TOUR_TIME).mix, `tour ${k}`).toBe(0);
		}
	});

	it("le tour part d un tour ENTIER, qui est deja le bon angle", () => {
		expect(tourLook(0).spin).toBe(SPIN);
		const depart = bot("neutre");
		depart.setLook(tourLook(0), 0);
		expect(depart.sample(1).eyes[0]!.matrix).toBe(
			bot("neutre").sample(1).eyes[0]!.matrix,
		);
	});

	it("le tour fait passer les yeux DERRIERE la boule", () => {
		const milieu = bot("neutre");
		milieu.setLook(tourLook(TOUR_TIME / 2), 0);
		expect(milieu.sample(1).eyes).toHaveLength(0);
	});

	it("ne peut pas anticiper le roulis, d ou une arrivee sans changement d etat", () => {
		expect(STATE_BY_ID.get("wink")!.pose(0).gaze.roll).not.toBe(
			EXPRESSION_BY_ID.get("neutre")!.gaze.roll,
		);
		expect(tourLook(0)).not.toHaveProperty("roll");
	});
});

describe("stabilite du regard entre expressions", () => {
	const oeilY = (m: BotEngine) =>
		+/matrix\([^,]+,[^,]+,[^,]+,[^,]+,-?[\d.]+,(-?[\d.]+)/.exec(
			m.sample(1).eyes[0]!.matrix,
		)![1]!;

	it("garde les yeux a la meme hauteur, quelle que soit l humeur affichee", () => {
		const hauteurs = HUMEURS.map((id) => {
			const m = new BotEngine(100, "idle", cercle(), EXPRESSION_BY_ID.get(id)!);
			m.setLook(lookTarget(vise()), 0);
			return oeilY(m);
		});
		const ecart = Math.max(...hauteurs) - Math.min(...hauteurs);
		expect(ecart, `ecart de hauteur de ${ecart.toFixed(1)} px`).toBeLessThan(4);
	});

	it("sans pilotage, les expressions gardent bien des hauteurs differentes", () => {
		const hauteurs = EXPRESSIONS.map((e) =>
			oeilY(new BotEngine(100, "idle", cercle(), EXPRESSION_BY_ID.get(e.id)!)),
		);
		expect(Math.max(...hauteurs) - Math.min(...hauteurs)).toBeGreaterThan(30);
	});

	it("ne retient que des humeurs a roulis nul, sinon la tete penche", () => {
		for (const id of HUMEURS) {
			expect(EXPRESSION_BY_ID.get(id)!.gaze.roll, id).toBe(0);
		}
	});
});
