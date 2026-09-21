import { momentOf } from "@/lib/format.ts";
import type { Listed, Ran } from "@/lib/reports.ts";

interface TrendSeries {
	key: string;
	target: string;
}

type TrendPoint = { at: number } & Record<string, number>;

export interface Trend {
	series: TrendSeries[];
	points: TrendPoint[];
}

function rate(passed: number, total: number): number {
	return Math.round((passed / total) * 100);
}

export function successTrend(runs: Listed[]): Trend {
	const ran = runs.flatMap((run): Ran[] => (run.ok ? [run] : []));
	const targets = [
		...new Set(
			ran.flatMap((run) =>
				run.byTarget
					.filter((one) => one.score.total > 0)
					.map((one) => one.target),
			),
		),
	].sort();
	const series = targets.map((target, index) => ({ key: `s${index}`, target }));
	const keyed = new Map(series.map((one) => [one.target, one.key]));
	const points = ran
		.map((run): TrendPoint => {
			const point: TrendPoint = { at: momentOf(run.startedAt) ?? run.ranAt };
			for (const one of run.byTarget) {
				const key = keyed.get(one.target);
				if (key === undefined) continue;
				point[key] = rate(one.score.passed, one.score.total);
			}
			return point;
		})
		.sort((a, b) => a.at - b.at);
	return { series, points };
}
