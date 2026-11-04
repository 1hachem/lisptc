import { describe, expect, it } from "vitest";
import { movedAcross } from "./sortable-sides.tsx";

const SIDES = { left: ["a", "b", "c"], right: ["x", "y"] };

describe("moving an entry between sides", () => {
	it("reorders within a side, onto the entry it was dropped on", () => {
		expect(movedAcross(SIDES, "a", "c")).toEqual({
			left: ["b", "c", "a"],
			right: ["x", "y"],
		});
	});

	it("moves across, before the entry it was dropped on", () => {
		expect(movedAcross(SIDES, "b", "y")).toEqual({
			left: ["a", "c"],
			right: ["x", "b", "y"],
		});
	});

	it("moves across to the end when dropped on the side itself", () => {
		expect(movedAcross(SIDES, "x", "side:left")).toEqual({
			left: ["a", "b", "c", "x"],
			right: ["y"],
		});
		expect(movedAcross({ left: ["a"], right: [] }, "a", "side:right")).toEqual({
			left: [],
			right: ["a"],
		});
	});

	it("does nothing when dropped on itself or nowhere", () => {
		expect(movedAcross(SIDES, "a", "a")).toBeUndefined();
		expect(movedAcross(SIDES, "a", undefined)).toBeUndefined();
		expect(movedAcross(SIDES, "a", "side:nowhere")).toBeUndefined();
	});
});
