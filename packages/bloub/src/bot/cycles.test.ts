import { describe, expect, it } from "vitest";
import {
	blockAt,
	blocksWith,
	type Cycle,
	clampDuration,
	defaultCycle,
	MAX_BLOCK,
	MAX_BLOCS,
	MAX_CYCLES,
	MIN_BLOCK,
	makeBlock,
	minDurationOf,
	moveBlock,
	nextCycleId,
	parseCycles,
	totalDuration,
	uniqueName,
} from "./cycles";
import { SEQUENCE, STATE_BY_ID, STATES } from "./states";

describe("cycle par defaut", () => {
	it("reprend la sequence relevee sur la video, dans l ordre", () => {
		expect(defaultCycle().blocks.map((b) => b.state)).toEqual(SEQUENCE);
	});

	it("tient chaque etat sa duree mesuree", () => {
		for (const block of defaultCycle().blocks) {
			expect(block.duration).toBe(STATE_BY_ID.get(block.state)!.duration);
		}
	});

	it("est reconstruit a l identique a chaque appel", () => {
		expect(defaultCycle()).toEqual(defaultCycle());
		expect(defaultCycle().blocks[0]).not.toBe(defaultCycle().blocks[0]);
	});

	it("laisse toujours de la place pour un nouveau cycle, sans collision", () => {
		const reference = defaultCycle();
		const un: Cycle = {
			id: nextCycleId([reference]),
			name: uniqueName("Mon cycle", [reference]),
			blocks: [],
		};
		const deux: Cycle = {
			id: nextCycleId([reference, un]),
			name: uniqueName("Mon cycle", [reference, un]),
			blocks: [],
		};
		expect(un.id).not.toBe(reference.id);
		expect(deux.id).not.toBe(un.id);
		expect(deux.name).not.toBe(un.name);
	});
});

describe("durees", () => {
	it("ne descend pas sous le plancher du moteur", () => {
		expect(clampDuration("idle", 0.1)).toBe(MIN_BLOCK);
		expect(clampDuration("idle", -5)).toBe(MIN_BLOCK);
	});

	it("respecte la mesure des etats qui ont besoin d aboutir", () => {
		expect(minDurationOf("alert")).toBe(2);
		expect(minDurationOf("burst")).toBe(2.4);
		expect(clampDuration("orbit", 1)).toBe(2.5);
		expect(minDurationOf("idle")).toBe(MIN_BLOCK);
	});

	it("n autorise aucun etat a descendre sous sa mesure", () => {
		for (const state of SEQUENCE) {
			expect(clampDuration(state, 0)).toBeGreaterThanOrEqual(
				minDurationOf(state),
			);
		}
	});

	it("plafonne et tombe sur le pas, sans trainee de flottants", () => {
		expect(clampDuration("idle", 999)).toBe(MAX_BLOCK);
		expect(clampDuration("idle", 2.44)).toBe(2.4);
		expect(clampDuration("idle", 2.46)).toBe(2.5);
	});
});

describe("lecture", () => {
	const cycle: Cycle = {
		id: "c1",
		name: "Test",
		blocks: [
			{ state: "idle", duration: 2 },
			{ state: "wink", duration: 1 },
			{ state: "egg", duration: 3 },
		],
	};

	it("additionne les blocs", () => {
		expect(totalDuration(cycle.blocks)).toBe(6);
	});

	it("trouve le bloc joue et le temps ecoule dedans", () => {
		expect(blockAt(cycle.blocks, 0)).toEqual({ index: 0, elapsed: 0 });
		expect(blockAt(cycle.blocks, 1.9)).toEqual({ index: 0, elapsed: 1.9 });
		expect(blockAt(cycle.blocks, 2)).toEqual({ index: 1, elapsed: 0 });
		expect(blockAt(cycle.blocks, 3.5)).toEqual({ index: 2, elapsed: 0.5 });
	});

	it("boucle au-dela du dernier bloc", () => {
		expect(blockAt(cycle.blocks, 6)).toEqual({ index: 0, elapsed: 0 });
		expect(blockAt(cycle.blocks, 8)).toEqual({ index: 1, elapsed: 0 });
	});

	it("ne casse pas sur un cycle vide", () => {
		expect(blockAt([], 3)).toEqual({ index: 0, elapsed: 0 });
		expect(totalDuration([])).toBe(0);
	});

	it("deplace un bloc sans toucher la liste d origine", () => {
		const blocks = cycle.blocks;
		expect(moveBlock(blocks, 0, 2).map((b) => b.state)).toEqual([
			"wink",
			"egg",
			"idle",
		]);
		expect(moveBlock(blocks, 2, 0).map((b) => b.state)).toEqual([
			"egg",
			"idle",
			"wink",
		]);
		expect(blocks.map((b) => b.state)).toEqual(["idle", "wink", "egg"]);
	});
});

describe("relecture du stockage", () => {
	it("ne casse pas sur du vide ou du JSON invalide", () => {
		expect(parseCycles(null)).toEqual([]);
		expect(parseCycles("")).toEqual([]);
		expect(parseCycles("{pas du json")).toEqual([]);
		expect(parseCycles('{"id":"c1"}')).toEqual([]);
	});

	it("jette les blocs dont l etat n existe plus", () => {
		const raw =
			'[{"id":"c1","name":"A","blocks":[{"state":"idle","duration":2},' +
			'{"state":"disparu","duration":2}]}]';
		expect(parseCycles(raw)[0]!.blocks.map((b) => b.state)).toEqual(["idle"]);
	});

	it("ramene les durees aberrantes dans leurs bornes", () => {
		const raw =
			'[{"id":"c1","name":"A","blocks":[{"state":"idle","duration":-4},' +
			'{"state":"egg","duration":9999}]}]';
		expect(parseCycles(raw)[0]!.blocks.map((b) => b.duration)).toEqual([
			MIN_BLOCK,
			MAX_BLOCK,
		]);
	});

	it("jette un cycle vide, sans nom, ou en double", () => {
		expect(parseCycles('[{"id":"c1","name":"A","blocks":[]}]')).toEqual([]);
		expect(
			parseCycles('[{"id":"c1","blocks":[{"state":"idle","duration":2}]}]'),
		).toEqual([]);
		const doublon =
			'[{"id":"c1","name":"A","blocks":[{"state":"idle","duration":2}]},' +
			'{"id":"c1","name":"B","blocks":[{"state":"egg","duration":2}]}]';
		expect(parseCycles(doublon).map((c) => c.name)).toEqual(["A"]);
	});

	it("ne garde que les champs du modele, pas ce qu on lui glisse en plus", () => {
		const raw =
			'[{"id":"defaut","name":"Mon montage","locked":true,"secret":1,' +
			'"blocks":[{"state":"idle","duration":2,"vitesse":3}]}]';
		const cycle = parseCycles(raw)[0]!;
		expect(Object.keys(cycle).sort()).toEqual(["blocks", "id", "name"]);
		expect(Object.keys(cycle.blocks[0]!).sort()).toEqual(["duration", "state"]);
	});

	it("borne la taille d un montage relu", () => {
		const blocs = Array.from({ length: 200_000 }, () => ({
			state: "idle",
			duration: 10,
		}));
		const raw = JSON.stringify([{ id: "c1", name: "A", blocks: blocs }]);
		expect(parseCycles(raw)[0]!.blocks).toHaveLength(MAX_BLOCS);
	});

	it("le plancher de bloc couvre le plus long fondu du catalogue", () => {
		const plusLong = Math.max(...STATES.map((s) => s.morph));
		expect(MIN_BLOCK).toBeGreaterThanOrEqual(plusLong);
		expect(MIN_BLOCK).toBe(plusLong);
	});

	it("borne aussi l ajout depuis l editeur, pas seulement la relecture", () => {
		let blocs = Array.from({ length: MAX_BLOCS }, () => makeBlock("idle"));
		expect(blocksWith(blocs, "egg")).toHaveLength(MAX_BLOCS);
		blocs = blocs.slice(0, MAX_BLOCS - 1);
		expect(blocksWith(blocs, "egg")).toHaveLength(MAX_BLOCS);
	});

	it("borne le nombre de montages relus", () => {
		const raw = JSON.stringify(
			Array.from({ length: 5000 }, (_, i) => ({
				id: `c${i}`,
				name: `A${i}`,
				blocks: [{ state: "idle", duration: 2 }],
			})),
		);
		expect(parseCycles(raw)).toHaveLength(MAX_CYCLES);
	});

	it("refuse un etat hors catalogue, `swirl` compris", () => {
		const raw =
			'[{"id":"c1","name":"A","blocks":[{"state":"swirl","duration":2},' +
			'{"state":"idle","duration":2}]}]';
		expect(parseCycles(raw)[0]!.blocks.map((b) => b.state)).toEqual(["idle"]);
		expect(
			parseCycles(
				'[{"id":"c1","name":"A","blocks":[{"state":"swirl","duration":2}]}]',
			),
		).toEqual([]);
	});
});
