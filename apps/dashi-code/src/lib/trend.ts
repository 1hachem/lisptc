import { weekOf } from "./git.ts";
import { median, weeksBetween } from "./plot.ts";
import type { PullRow } from "./pulls.ts";

const HOURS_PER_DAY = 24;

type Merged = PullRow & { mergedAt: string; hours: number };

export interface MergeTrend {
	weeks: string[];
	days: (number | null)[];
	reach: (number | null)[];
	files: (number | null)[];
	merged: number[];
}

const EMPTY: MergeTrend = {
	weeks: [],
	days: [],
	reach: [],
	files: [],
	merged: [],
};

function mean(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function bucket(rows: PullRow[]): Map<string, Merged[]> {
	const out = new Map<string, Merged[]>();
	for (const row of rows) {
		if (row.mergedAt === null || row.hours === null) continue;
		const week = weekOf(row.mergedAt.slice(0, 10));
		const held = out.get(week);
		if (held === undefined) out.set(week, [row as Merged]);
		else held.push(row as Merged);
	}
	return out;
}

export function mergeTrendOf(rows: PullRow[]): MergeTrend {
	const buckets = bucket(rows);
	const stamps = [...buckets.keys()].sort();
	const first = stamps[0];
	const last = stamps[stamps.length - 1];
	if (first === undefined || last === undefined) return EMPTY;

	const weeks = weeksBetween(first, last);
	const over = <T>(pick: (held: Merged[]) => T): (T | null)[] =>
		weeks.map((week) => {
			const held = buckets.get(week);
			return held === undefined ? null : pick(held);
		});

	return {
		weeks,
		days: over((held) => median(held.map((row) => row.hours / HOURS_PER_DAY))),
		reach: over((held) => mean(held.map((row) => row.reach))),
		files: over((held) => mean(held.map((row) => row.blastFiles))),
		merged: weeks.map((week) => buckets.get(week)?.length ?? 0),
	};
}
