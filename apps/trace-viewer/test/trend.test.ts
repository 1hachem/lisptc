import { describe, expect, it } from "vitest";
import type { Listed, TargetScore } from "@/lib/reports.ts";
import { successTrend } from "@/lib/trend.ts";

function ran(startedAt: string, byTarget: TargetScore[]): Listed {
	return {
		ok: true,
		file: `${startedAt}.json`,
		ranAt: 0,
		startedAt,
		targets: byTarget.map((one) => one.target),
		byTarget,
		cases: byTarget.length,
		score: { passed: 0, total: 0, tone: "red" },
	};
}

function scored(target: string, passed: number, total: number): TargetScore {
	return { target, score: { passed, total, tone: "green" } };
}

describe("successTrend", () => {
	it("gives every target a key and every run a point in time order", () => {
		const trend = successTrend([
			ran("2026-03-02T10-00-00", [scored("do · b", 1, 4)]),
			ran("2026-03-01T10-00-00", [
				scored("do · a", 3, 4),
				scored("do · b", 2, 4),
			]),
		]);

		expect(trend.series).toEqual([
			{ key: "s0", target: "do · a" },
			{ key: "s1", target: "do · b" },
		]);
		expect(trend.points).toEqual([
			{ at: Date.UTC(2026, 2, 1, 10), s0: 75, s1: 50 },
			{ at: Date.UTC(2026, 2, 2, 10), s1: 25 },
		]);
	});

	it("leaves out an unreadable run and a target with no checks", () => {
		const trend = successTrend([
			{ ok: false, file: "broken.json", ranAt: 0, why: "unreadable" },
			ran("2026-03-01T10-00-00", [
				scored("do · a", 0, 0),
				scored("do · b", 0, 2),
			]),
		]);

		expect(trend.series).toEqual([{ key: "s0", target: "do · b" }]);
		expect(trend.points).toEqual([{ at: Date.UTC(2026, 2, 1, 10), s0: 0 }]);
	});
});
