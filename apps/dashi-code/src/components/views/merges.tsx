"use client";

import { TipLine, useTip } from "@/components/tip.tsx";
import { count } from "@/lib/format.ts";
import { area, scale, ticks, weekLabel } from "@/lib/plot.ts";
import type { MergeTrend } from "@/lib/trend.ts";

const W = 760;
const H = 330;
const M = { top: 16, right: 18, bottom: 40, left: 52 };
const SPLIT = 0.56;
const GAP = 30;
const X_LABELS = 8;
const DOT = 5;

function pathOf(
	values: (number | null)[],
	x: (at: number) => number,
	y: (value: number) => number,
): string {
	let out = "";
	let drawn = false;
	values.forEach((value, at) => {
		if (value === null) {
			drawn = false;
			return;
		}
		out += `${drawn ? "L" : "M"}${x(at)},${y(value)} `;
		drawn = true;
	});
	return out.trim();
}

export function Merges({ trend }: { trend: MergeTrend }) {
	const { bind, layer } = useTip();
	const weeks = trend.weeks;
	if (weeks.length === 0)
		return <p className="m-0 text-dim">no pull request merged in the window</p>;

	const plot = H - M.top - M.bottom;
	const daysHigh = plot * SPLIT - GAP / 2;
	const reachHigh = plot * (1 - SPLIT) - GAP / 2;
	const reachTop = M.top + daysHigh + GAP;

	const pct = trend.reach.map((value) => (value === null ? null : value * 100));
	const dayMax = Math.max(1, ...trend.days.map((value) => value ?? 0));
	const pctMax = Math.max(1, ...pct.map((value) => value ?? 0));
	const day = scale(0, dayMax, M.top + daysHigh, M.top);
	const reach = scale(0, pctMax, reachTop + reachHigh, reachTop);
	const dot = area(Math.max(1, ...trend.merged), DOT);

	const band = (W - M.left - M.right) / weeks.length;
	const x = (at: number): number => M.left + at * band + band / 2;
	const every = Math.max(1, Math.round(weeks.length / X_LABELS));

	return (
		<>
			<svg
				className="block h-auto w-full min-w-[560px]"
				viewBox={`0 0 ${W} ${H}`}
				aria-label="median time to merge and average blast radius, by week"
				role="img"
			>
				{ticks(0, dayMax, 3).map((tick) => (
					<line
						key={`d${tick}`}
						stroke="var(--grid)"
						x1={M.left}
						x2={W - M.right}
						y1={day(tick)}
						y2={day(tick)}
					/>
				))}
				{ticks(0, pctMax, 3).map((tick) => (
					<line
						key={`r${tick}`}
						stroke="var(--grid)"
						x1={M.left}
						x2={W - M.right}
						y1={reach(tick)}
						y2={reach(tick)}
					/>
				))}
				<path
					d={pathOf(trend.days, x, day)}
					fill="none"
					stroke="var(--s1)"
					strokeWidth={1.8}
				/>
				<path
					d={pathOf(pct, x, reach)}
					fill="none"
					stroke="var(--crit)"
					strokeWidth={1.8}
				/>
				{weeks.map((week, at) => {
					const days = trend.days[at];
					const spread = pct[at];
					const merged = trend.merged[at] ?? 0;
					const tip = bind(
						<TipLine name={weekLabel(week)}>
							{merged === 0 ? (
								"nothing merged"
							) : (
								<>
									{merged} merged · {(days ?? 0).toFixed(1)}d median to merge ·{" "}
									{(spread ?? 0).toFixed(0)}% of workspaces in reach ·{" "}
									{count(Math.round(trend.files[at] ?? 0))} source files
								</>
							)}
						</TipLine>,
					);
					return (
						<g key={week} {...tip}>
							<rect
								fill="transparent"
								height={H - M.top - M.bottom}
								width={band}
								x={M.left + at * band}
								y={M.top}
							/>
							{days === null ? null : (
								<circle
									cx={x(at)}
									cy={day(days)}
									fill="var(--s1)"
									r={Math.max(1.5, dot(merged))}
								/>
							)}
							{spread === null ? null : (
								<circle
									cx={x(at)}
									cy={reach(spread)}
									fill="var(--crit)"
									r={2}
								/>
							)}
						</g>
					);
				})}
				{ticks(0, dayMax, 3).map((tick) => (
					<text
						fill="var(--muted-plot)"
						fontSize={10}
						key={`d${tick}`}
						textAnchor="end"
						x={M.left - 7}
						y={day(tick) + 3.5}
					>
						{tick}d
					</text>
				))}
				{ticks(0, pctMax, 3).map((tick) => (
					<text
						fill="var(--muted-plot)"
						fontSize={10}
						key={`r${tick}`}
						textAnchor="end"
						x={M.left - 7}
						y={reach(tick) + 3.5}
					>
						{tick}%
					</text>
				))}
				<text fill="var(--dim-plot)" fontSize={10.5} x={M.left} y={M.top + 9}>
					median days to merge · dot sized by merges
				</text>
				<text
					fill="var(--dim-plot)"
					fontSize={10.5}
					x={M.left}
					y={reachTop - 6}
				>
					average blast radius, share of workspaces
				</text>
				{weeks.map((week, at) =>
					at % every === 0 ? (
						<text
							fill="var(--muted-plot)"
							fontSize={10}
							key={week}
							textAnchor="middle"
							x={x(at)}
							y={H - M.bottom + 26}
						>
							{weekLabel(week)}
						</text>
					) : null,
				)}
			</svg>
			{layer}
		</>
	);
}
