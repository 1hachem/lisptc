import { describe, expect, it } from "vitest";
import {
	awaitingSides,
	movedAcross,
	stillAwaiting,
} from "./sortable-sides.tsx";

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

describe("the order held after a drop", () => {
	it("shows the dropped order until the stored one catches up", () => {
		const next = { left: ["a", "c"], right: ["x", "b", "y"] };
		const dropped = { next, over: SIDES };
		expect(awaitingSides(SIDES, dropped)).toEqual(next);
		expect(awaitingSides({ ...next }, dropped)).toEqual(next);
	});

	it("follows the stored order once it changes from elsewhere", () => {
		const elsewhere = { left: ["c", "a", "b"], right: ["x", "y"] };
		expect(
			awaitingSides(elsewhere, {
				next: { left: ["a"], right: ["b"] },
				over: SIDES,
			}),
		).toEqual(elsewhere);
		expect(awaitingSides(SIDES, undefined)).toEqual(SIDES);
	});

	it("shows the old order again when a failed save puts it back", () => {
		const next = { left: ["a", "c"], right: ["x", "b", "y"] };
		const saving = stillAwaiting(next, { next, over: SIDES });
		expect(saving).toBeUndefined();
		expect(awaitingSides(SIDES, saving)).toEqual(SIDES);
	});
});
