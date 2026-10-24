import { describe, expect, it } from "vitest";
import { barOrder, placeOf, shownItems } from "../src/lib/status-bar-order.ts";

describe("barOrder", () => {
	it("puts the pane indicator left and the clock right, the centre empty, when nothing is stored", () => {
		const order = barOrder(undefined);
		expect(order).toEqual(["panes", "gap", "clock"]);
		expect(order.map((slot) => placeOf(order, slot))).toEqual([
			"left",
			"centre",
			"right",
		]);
	});

	it("keeps an item stored in the centre there", () => {
		expect(barOrder(["gap", "clock", "panes"])).toEqual([
			"gap",
			"clock",
			"panes",
		]);
	});

	it("keeps two stored items at either end, and drops one the bar no longer has", () => {
		expect(barOrder(["clock", "panes"])).toEqual(["clock", "gap", "panes"]);
		expect(barOrder(["minimized", "clock", "panes"])).toEqual([
			"clock",
			"gap",
			"panes",
		]);
	});

	it("has one empty slot however many are stored", () => {
		expect(barOrder(["gap", "gap", "panes"])).toEqual([
			"gap",
			"panes",
			"clock",
		]);
	});
});

describe("shownItems", () => {
	it("lists the items on show, never the empty slot", () => {
		expect(shownItems(["panes", "gap", "clock"], ["clock"])).toEqual(["panes"]);
	});
});
