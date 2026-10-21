import { describe, expect, it } from "vitest";
import {
	barOrder,
	placeOf,
	reorderedShown,
} from "../src/lib/status-bar-order.ts";

describe("barOrder", () => {
	it("docks the minimized tabs on the right when nothing is stored", () => {
		const order = barOrder(undefined);
		expect(order).toEqual(["panes", "clock", "minimized"]);
		expect(placeOf(order, "minimized")).toBe("right");
	});
});

describe("placeOf", () => {
	it("fills left, centre and right in order", () => {
		const order = barOrder(["minimized", "panes", "clock"]);
		expect(order.map((item) => placeOf(order, item))).toEqual([
			"left",
			"centre",
			"right",
		]);
	});

	it("puts a lone item on the right and two at either end", () => {
		expect(placeOf(["minimized"], "minimized")).toBe("right");
		expect(placeOf(["minimized", "clock"], "minimized")).toBe("left");
	});
});

describe("reorderedShown", () => {
	it("keeps a hidden item where it was when the shown ones are dragged", () => {
		expect(
			reorderedShown(["panes", "clock", "minimized"], ["minimized", "panes"]),
		).toEqual(["minimized", "clock", "panes"]);
	});
});
