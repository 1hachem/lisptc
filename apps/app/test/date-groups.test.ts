import { describe, expect, it } from "vitest";
import { byDate, dateGroupOf } from "../src/lib/date-groups.ts";

const now = new Date(2026, 9, 20, 9, 30).getTime();
const daysAgo = (days: number, hour = 12) =>
	new Date(2026, 9, 20 - days, hour).getTime();

describe("dateGroupOf", () => {
	it("goes by calendar day, not by hours since", () => {
		expect(dateGroupOf(new Date(2026, 9, 20, 0, 5).getTime(), now)).toBe(
			"today",
		);
		expect(dateGroupOf(daysAgo(1, 23), now)).toBe("yesterday");
	});

	it("reaches back a week, then a month, then older", () => {
		expect(dateGroupOf(daysAgo(2), now)).toBe("last week");
		expect(dateGroupOf(daysAgo(7), now)).toBe("last week");
		expect(dateGroupOf(daysAgo(8), now)).toBe("last month");
		expect(dateGroupOf(daysAgo(30), now)).toBe("last month");
		expect(dateGroupOf(daysAgo(31), now)).toBe("older");
	});
});

describe("byDate", () => {
	it("groups newest first and leaves out the empty groups", () => {
		const files = [
			{ name: "old.md", at: daysAgo(40) },
			{ name: "a.md", at: daysAgo(0, 8) },
			{ name: "b.md", at: daysAgo(0, 9) },
			{ name: "c.md", at: daysAgo(3) },
		];
		expect(
			byDate(files, (file) => file.at, now).map(({ group, items }) => [
				group,
				items.map((file) => file.name),
			]),
		).toEqual([
			["today", ["b.md", "a.md"]],
			["last week", ["c.md"]],
			["older", ["old.md"]],
		]);
	});
});
