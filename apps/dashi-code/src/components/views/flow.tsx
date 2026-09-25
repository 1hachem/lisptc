"use client";

import { TipLine, useTip } from "@/components/tip.tsx";
import { scale, ticks, weekLabel } from "@/lib/plot.ts";
import type { PullFlow } from "@/lib/pulls.ts";

const W = 760;
const H = 340;
const M = { top: 14, right: 18, bottom: 40, left: 52 };
const SPLIT = 0.62;
const GAP = 26;
const X_LABELS = 8;

export function Flow({ flow }: { flow: PullFlow }) {
	const { bind, layer } = useTip();
	const weeks = flow.weeks;
	if (weeks.length === 0)
		return <p className="m-0 text-dim">no pull requests in the window</p>;

	const plot = H - M.top - M.bottom;
	const barsHigh = plot * SPLIT - GAP / 2;
	const lineHigh = plot * (1 - SPLIT) - GAP / 2;
	const lineTop = M.top + barsHigh + GAP;

	const resolved = weeks.map(
		(_, at) => (flow.merged[at] ?? 0) + (flow.closed[at] ?? 0),
	);
	const up = Math.max(1, ...flow.opened);
	const down = Math.max(1, ...resolved);
	const zero = M.top + (barsHigh * up) / (up + down);
	const above = scale(0, up, zero, M.top);
	const below = scale(0, down, zero, M.top + barsHigh);
	const backlogMax = Math.max(1, ...flow.open);
	const backlog = scale(0, backlogMax, lineTop + lineHigh, lineTop);

	const band = (W - M.left - M.right) / weeks.length;
	const x = (at: number): number => M.left + at * band;
	const bar = Math.max(1.5, band - 2);
	const every = Math.max(1, Math.round(weeks.length / X_LABELS));

	const path = flow.open
		.map(
			(open, at) =>
				`${at === 0 ? "M" : "L"}${x(at) + band / 2},${backlog(open)}`,
		)
		.join(" ");

	return (
		<>
			<svg
				className="block h-auto w-full min-w-[560px]"
				viewBox={`0 0 ${W} ${H}`}
				aria-label="pull requests opened, resolved and left open, by week"
				role="img"
			>
				<line
					stroke="var(--axis)"
					x1={M.left}
					x2={W - M.right}
					y1={zero}
					y2={zero}
				/>
				{ticks(0, backlogMax, 3).map((tick) => (
					<line
						key={tick}
						stroke="var(--grid)"
						x1={M.left}
						x2={W - M.right}
						y1={backlog(tick)}
						y2={backlog(tick)}
					/>
				))}
				{weeks.map((week, at) => {
					const opened = flow.opened[at] ?? 0;
					const merged = flow.merged[at] ?? 0;
					const closed = flow.closed[at] ?? 0;
					const tip = bind(
						<TipLine name={weekLabel(week)}>
							{opened} opened · {merged} merged · {closed} closed unmerged ·{" "}
							{flow.open[at] ?? 0} still open
						</TipLine>,
					);
					return (
						<g key={week} {...tip}>
							<rect
								fill="transparent"
								height={H - M.top - M.bottom}
								width={band}
								x={x(at)}
								y={M.top}
							/>
							<rect
								fill="var(--s1)"
								height={Math.max(0, zero - above(opened))}
								width={bar}
								x={x(at) + 1}
								y={above(opened)}
							/>
							<rect
								fill="var(--s2)"
								height={Math.max(0, below(merged) - zero)}
								width={bar}
								x={x(at) + 1}
								y={zero}
							/>
							<rect
								fill="var(--muted-plot)"
								height={Math.max(0, below(merged + closed) - below(merged))}
								width={bar}
								x={x(at) + 1}
								y={below(merged)}
							/>
						</g>
					);
				})}
				<path d={path} fill="none" stroke="var(--crit)" strokeWidth={1.8} />
				{ticks(0, backlogMax, 3).map((tick) => (
					<text
						fill="var(--muted-plot)"
						fontSize={10}
						key={tick}
						textAnchor="end"
						x={M.left - 7}
						y={backlog(tick) + 3.5}
					>
						{tick}
					</text>
				))}
				<text fill="var(--dim-plot)" fontSize={10.5} x={M.left} y={M.top + 9}>
					opened ↑
				</text>
				<text
					fill="var(--dim-plot)"
					fontSize={10.5}
					x={M.left}
					y={M.top + barsHigh - 1}
				>
					resolved ↓
				</text>
				<text fill="var(--dim-plot)" fontSize={10.5} x={M.left} y={lineTop - 6}>
					left open at week end
				</text>
				{weeks.map((week, at) =>
					at % every === 0 ? (
						<text
							fill="var(--muted-plot)"
							fontSize={10}
							key={week}
							textAnchor="middle"
							x={x(at) + band / 2}
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
