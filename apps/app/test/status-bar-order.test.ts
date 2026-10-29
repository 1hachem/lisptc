import { describe, expect, it } from "vitest";
import {
	barOrder,
	placeOf,
	SLOT_COUNT,
	shownItems,
} from "../src/lib/status-bar-order.ts";

describe("barOrder", () => {
	it("puts the pane indicator first and the desktop status beside the clock last, gaps between, when nothing is stored", () => {
		const order = barOrder(undefined);
		expect(order).toEqual([
			"panes",
			"gap-1",
			"gap-2",
			"gap-3",
			"gap-4",
			"gap-5",
			"gap-6",
			"desktop",
			"clock",
		]);
		expect(order.map((slot) => placeOf(order, slot))).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9,
		]);
	});

	it("always has nine slots", () => {
		expect(barOrder(undefined)).toHaveLength(SLOT_COUNT);
		expect(barOrder(["clock"])).toHaveLength(SLOT_COUNT);
		expect(barOrder(["gap-3", "desktop", "panes", "clock"])).toHaveLength(
			SLOT_COUNT,
		);
	});

	it("turns an old row's single empty slot into a gap id and keeps it in place", () => {
		expect(barOrder(["panes", "gap", "clock"])).toEqual([
			"panes",
			"gap-2",
			"gap-3",
			"gap-4",
			"gap-5",
			"gap-6",
			"gap-1",
			"desktop",
			"clock",
		]);
	});

	it("keeps the desktop status wherever it is stored, apart from the clock", () => {
		const order = barOrder([
			"desktop",
			"gap-1",
			"gap-2",
			"panes",
			"gap-3",
			"gap-4",
			"clock",
		]);
		expect(placeOf(order, "desktop")).toBe(1);
		expect(placeOf(order, "panes")).toBe(6);
		expect(placeOf(order, "clock")).toBe(SLOT_COUNT);
	});

	it("keeps several stored gaps and drops unknown and repeated names", () => {
		expect(
			barOrder([
				"clock",
				"gap-2",
				"gap-2",
				"minimized",
				"gap-1",
				"panes",
				"desktop",
				"gap-9",
			]),
		).toEqual([
			"clock",
			"gap-3",
			"gap-4",
			"gap-5",
			"gap-6",
			"gap-2",
			"gap-1",
			"panes",
			"desktop",
		]);
	});
});

describe("shownItems", () => {
	it("lists the items on show, never a gap", () => {
		expect(
			shownItems(
				[
					"panes",
					"gap-1",
					"gap-2",
					"gap-3",
					"gap-4",
					"gap-5",
					"gap-6",
					"desktop",
					"clock",
				],
				["clock"],
			),
		).toEqual(["panes", "desktop"]);
	});
});
