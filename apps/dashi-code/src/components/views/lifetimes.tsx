"use client";

import { TipLine, useTip } from "@/components/tip.tsx";
import { count } from "@/lib/format.ts";
import { area, scale } from "@/lib/plot.ts";
import type { PullRow } from "@/lib/pulls.ts";

const W = 760;
const ROW = 15;
const M = { top: 16, right: 96, bottom: 30, left: 56 };
const DAY_MS = 24 * 60 * 60 * 1000;

const stateColor: Record<PullRow["state"], string> = {
	open: "var(--crit)",
	merged: "var(--s1)",
	closed: "var(--muted-plot)",
};

function endOf(row: PullRow): number {
	const closed = row.mergedAt ?? row.closedAt;
	return closed === null ? Date.now() : Date.parse(closed);
}

function churnOf(commit: PullRow["commits"][number]): number {
	return (commit.added ?? 0) + (commit.deleted ?? 0);
}

export function Lifetimes({ rows }: { rows: PullRow[] }) {
	const { bind, layer } = useTip();
	if (rows.length === 0)
		return <p className="m-0 text-dim">no pull requests in the window</p>;

	const H = M.top + rows.length * ROW + M.bottom;
	const stamps = rows.flatMap((row) => [
		Date.parse(row.openedAt),
		endOf(row),
		...row.commits.map((commit) => Date.parse(commit.at)),
	]);
	const from = Math.min(...stamps);
	const to = Math.max(...stamps);
	const x = scale(from, to, M.left, W - M.right);
	const biggest = Math.max(
		1,
		...rows.flatMap((row) => row.commits.map(churnOf)),
	);
	const r = area(biggest, 5.5);
	const days = Math.max(1, Math.round((to - from) / DAY_MS));
	const marks = Array.from(
		{ length: 5 },
		(_, at) => from + ((to - from) * at) / 4,
	);

	return (
		<>
			<svg
				className="block h-auto w-full min-w-[620px]"
				viewBox={`0 0 ${W} ${H}`}
			>
				<title>
					every pull request from the day it opened to the day it closed
				</title>
				{marks.map((mark) => (
					<line
						key={mark}
						stroke="var(--grid)"
						x1={x(mark)}
						x2={x(mark)}
						y1={M.top - 6}
						y2={H - M.bottom + 2}
					/>
				))}
				{rows.map((row, at) => {
					const y = M.top + at * ROW + ROW / 2;
					const color = stateColor[row.state];
					let running = 0;
					return (
						<g key={row.number}>
							<text
								fill="var(--dim-plot)"
								fontSize={9.5}
								textAnchor="end"
								x={M.left - 8}
								y={y + 3}
							>
								#{row.number}
							</text>
							<line
								stroke={color}
								strokeLinecap="round"
								strokeOpacity={0.45}
								strokeWidth={3}
								x1={x(Date.parse(row.openedAt))}
								x2={x(endOf(row))}
								y1={y}
								y2={y}
								{...bind(
									<TipLine name={`#${row.number} ${row.title}`}>
										{row.state} · {row.commits.length} commits · +
										{count(row.added)} −{count(row.deleted)} across{" "}
										{row.changed} files ·{" "}
										{row.hours === null
											? "still open"
											: `${(row.hours / 24).toFixed(1)} days`}
									</TipLine>,
								)}
							/>
							{row.commits.map((commit) => {
								running += churnOf(commit);
								const here = running;
								return (
									<circle
										cx={x(Date.parse(commit.at))}
										cy={y}
										fill={color}
										fillOpacity={0.85}
										key={commit.sha}
										r={Math.max(r(churnOf(commit)), 1.6)}
										stroke="var(--bg1)"
										strokeWidth={0.8}
										{...bind(
											<TipLine name={commit.headline || commit.sha.slice(0, 7)}>
												#{row.number} · {commit.at.slice(0, 10)} ·{" "}
												{commit.added === null
													? "churn not in this clone"
													: `+${count(commit.added)} −${count(commit.deleted ?? 0)}, ${count(here)} changed so far`}
											</TipLine>,
										)}
									/>
								);
							})}
							<text
								fill="var(--muted-plot)"
								fontSize={9.5}
								x={W - M.right + 8}
								y={y + 3}
							>
								+{count(row.added)} −{count(row.deleted)}
							</text>
						</g>
					);
				})}
				{marks.map((mark) => (
					<text
						fill="var(--muted-plot)"
						fontSize={10}
						key={mark}
						textAnchor="middle"
						x={x(mark)}
						y={H - M.bottom + 16}
					>
						{new Date(mark).toLocaleDateString("en-US", {
							day: "numeric",
							month: "short",
							timeZone: "UTC",
						})}
					</text>
				))}
				<text
					fill="var(--dim-plot)"
					fontSize={10.5}
					textAnchor="middle"
					x={(M.left + W - M.right) / 2}
					y={H - 4}
				>
					{days} days · dot area is the churn that commit landed
				</text>
			</svg>
			{layer}
		</>
	);
}
