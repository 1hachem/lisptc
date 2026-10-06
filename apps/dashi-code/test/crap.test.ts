import { describe, expect, it } from "vitest";
import {
	CRAPPY,
	crapDocumentOf,
	crapOf,
	crapPointFrom,
	crapPointOf,
} from "../src/lib/crap.ts";

const HEAD = "0123456789abcdef";

function finding(name: string, crap: number | null, line = 1) {
	return {
		path: `packages/a/src/${name}.ts`,
		name,
		line,
		cyclomatic: 4,
		crap,
		coverage_pct: 50,
	};
}

function health(...findings: ReturnType<typeof finding>[]) {
	return {
		kind: "health",
		summary: { coverage_model: "static_estimated" },
		findings,
	};
}

describe("crapPointOf", () => {
	it("aggregates every scored function and skips the unscored", () => {
		const point = crapPointOf(
			health(
				finding("low", 2),
				finding("edge", CRAPPY),
				finding("high", 90),
				finding("unscored", null),
			),
			HEAD,
			1000,
		);
		expect(point.functions).toBe(3);
		expect(point.total).toBe(2 + CRAPPY + 90);
		expect(point.mean).toBeCloseTo((2 + CRAPPY + 90) / 3);
		expect(point.crappy).toBe(2);
		expect(point.p90).toBe(90);
		expect(point.worst.map((row) => row.name)).toEqual(["high", "edge", "low"]);
	});

	it("keeps only the twelve worst functions", () => {
		const many = Array.from({ length: 20 }, (_, at) =>
			finding(`f${at}`, at, at),
		);
		const point = crapPointOf(health(...many), HEAD, 1000);
		expect(point.worst).toHaveLength(12);
		expect(point.worst[0]?.crap).toBe(19);
	});

	it("refuses a report scored from istanbul coverage", () => {
		const report = {
			...health(finding("a", 40)),
			summary: { coverage_model: "istanbul" },
		};
		expect(() => crapPointOf(report, HEAD, 1000)).toThrow(/istanbul/);
	});

	it("refuses a report that scored nothing", () => {
		expect(() =>
			crapPointOf(health(finding("unscored", null)), HEAD, 1000),
		).toThrow(/scored no function/);
	});
});

describe("a stored point", () => {
	it("reads back through its schema", () => {
		const point = crapPointOf(health(finding("a", 40)), HEAD, 1000);
		expect(crapPointFrom(JSON.parse(crapDocumentOf(point)))).toEqual(point);
	});

	it("is refused when it is another kind of document", () => {
		expect(crapPointFrom(health(finding("a", 40)))).toBeNull();
	});
});

describe("crapOf", () => {
	it("orders history oldest first and takes the newest as latest", () => {
		const older = crapPointOf(health(finding("a", 40)), HEAD, 1000);
		const newer = crapPointOf(health(finding("a", 10)), "fedcba98", 2000);
		const crap = crapOf([newer, older]);
		expect(crap?.latest.generated).toBe(2000);
		expect(crap?.history.map((point) => point.crappy)).toEqual([1, 0]);
		expect(crap?.history[0]).not.toHaveProperty("worst");
	});

	it("keeps only the newest of back-to-back analyses of one commit", () => {
		const first = crapPointOf(health(finding("a", 40)), HEAD, 1000);
		const again = crapPointOf(health(finding("a", 40)), HEAD, 2000);
		const moved = crapPointOf(health(finding("a", 10)), "fedcba98", 3000);
		const back = crapPointOf(health(finding("a", 40)), HEAD, 4000);
		const crap = crapOf([again, back, first, moved]);
		expect(crap?.history.map((point) => point.generated)).toEqual([
			2000, 3000, 4000,
		]);
	});

	it("is null with nothing stored", () => {
		expect(crapOf([])).toBeNull();
	});
});
