import type { PullFlow, PullRow, Pulls } from "./pulls.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface Span {
	id: string;
	label: string;
	days: number | null;
}

const ALL: Span = { id: "all", label: "all time", days: null };

export const spans: Span[] = [
	{ id: "1w", label: "1 week", days: 7 },
	{ id: "1m", label: "1 month", days: 30 },
	{ id: "3m", label: "3 months", days: 91 },
	{ id: "6m", label: "6 months", days: 182 },
	{ id: "1y", label: "1 year", days: 365 },
	ALL,
];

export const wholeSpan = ALL;

export function spanOf(id: string | undefined): Span {
	return spans.find((span) => span.id === id) ?? ALL;
}

function alive(row: PullRow, from: number): boolean {
	const closed = row.mergedAt ?? row.closedAt;
	return closed === null || Date.parse(closed) >= from;
}

function sliceFlow(flow: PullFlow, from: number): PullFlow {
	const kept = flow.weeks
		.map((week, at) => ({ week, at }))
		.filter(({ week }) => Date.parse(`${week}T00:00:00Z`) + WEEK_MS > from);
	const pick = (values: number[]): number[] =>
		kept.map(({ at }) => values[at] ?? 0);
	return {
		weeks: kept.map(({ week }) => week),
		opened: pick(flow.opened),
		merged: pick(flow.merged),
		closed: pick(flow.closed),
		open: pick(flow.open),
	};
}

export function narrow(view: Pulls, span: Span): Pulls {
	if (span.days === null) return view;
	const from = view.generated - span.days * DAY_MS;
	return {
		...view,
		flow: sliceFlow(view.flow, from),
		rows: view.rows.filter((row) => alive(row, from)),
	};
}
