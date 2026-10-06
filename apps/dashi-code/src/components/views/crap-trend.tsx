"use client";

import { TipLine, useTip } from "@/components/tip.tsx";
import { CRAPPY, type CrapSummary } from "@/lib/crap.ts";
import { count, when } from "@/lib/format.ts";
import { scale, ticks } from "@/lib/plot.ts";

const W = 760;
const H = 300;
const M = { top: 16, right: 18, bottom: 34, left: 52 };
const SPLIT = 0.56;
const GAP = 30;
const X_LABELS = 6;
const HIT = 10;

function pathOf(
	points: CrapSummary[],
	x: (at: number) => number,
	y: (value: number) => number,
	pick: (point: CrapSummary) => number,
): string {
	return points
		.map(
			(point, at) =>
				`${at === 0 ? "M" : "L"}${x(point.generated)},${y(pick(point))}`,
		)
		.join(" ");
}

function day(at: number): string {
	return new Date(at).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	});
}

export function CrapTrend({ history }: { history: CrapSummary[] }) {
	const { bind, layer } = useTip();
	const first = history[0];
	const last = history[history.length - 1];
	if (first === undefined || last === undefined)
		return <p className="m-0 text-dim">no CRAP measured yet</p>;

	const plot = H - M.top - M.bottom;
	const crappyHigh = plot * SPLIT - GAP / 2;
	const meanHigh = plot * (1 - SPLIT) - GAP / 2;
	const meanTop = M.top + crappyHigh + GAP;

	const crappyMax = Math.max(1, ...history.map((point) => point.crappy));
	const meanMax = Math.max(1, ...history.map((point) => point.mean));
	const crappy = scale(0, crappyMax, M.top + crappyHigh, M.top);
	const mean = scale(0, meanMax, meanTop + meanHigh, meanTop);
	const x =
		first.generated === last.generated
			? () => (M.left + W - M.right) / 2
			: scale(first.generated, last.generated, M.left, W - M.right);
	const days = history.filter(
		(point, at) =>
			day(point.generated) !== day(history[at - 1]?.generated ?? Number.NaN),
	);
	const every = Math.ceil(days.length / X_LABELS);
	const labels = days.filter((_, at) => at % every === 0);

	return (
		<>
			<svg
				className="block h-auto w-full min-w-[560px]"
				viewBox={`0 0 ${W} ${H}`}
				aria-label={`functions at CRAP ${CRAPPY} or more, and mean CRAP, per analysis`}
				role="img"
			>
				{ticks(0, crappyMax, 3).map((tick) => (
					<line
						key={`c${tick}`}
						stroke="var(--grid)"
						x1={M.left}
						x2={W - M.right}
						y1={crappy(tick)}
						y2={crappy(tick)}
					/>
				))}
				{ticks(0, meanMax, 3).map((tick) => (
					<line
						key={`m${tick}`}
						stroke="var(--grid)"
						x1={M.left}
						x2={W - M.right}
						y1={mean(tick)}
						y2={mean(tick)}
					/>
				))}
				<path
					d={pathOf(history, x, crappy, (point) => point.crappy)}
					fill="none"
					stroke="var(--crit)"
					strokeWidth={1.8}
				/>
				<path
					d={pathOf(history, x, mean, (point) => point.mean)}
					fill="none"
					stroke="var(--s1)"
					strokeWidth={1.8}
				/>
				{history.map((point) => (
					<g
						key={point.generated}
						{...bind(
							<TipLine
								name={`${when(point.generated)} · ${point.head.slice(0, 7)}`}
							>
								{count(point.crappy)} at {CRAPPY}+ · mean{" "}
								{point.mean.toFixed(1)} · p90 {point.p90.toFixed(1)} ·{" "}
								{count(point.functions)} functions
							</TipLine>,
						)}
					>
						<rect
							fill="transparent"
							height={plot}
							width={HIT * 2}
							x={x(point.generated) - HIT}
							y={M.top}
						/>
						<circle
							cx={x(point.generated)}
							cy={crappy(point.crappy)}
							fill="var(--crit)"
							r={2.5}
						/>
						<circle
							cx={x(point.generated)}
							cy={mean(point.mean)}
							fill="var(--s1)"
							r={2.5}
						/>
					</g>
				))}
				{ticks(0, crappyMax, 3).map((tick) => (
					<text
						fill="var(--muted-plot)"
						fontSize={10}
						key={`c${tick}`}
						textAnchor="end"
						x={M.left - 7}
						y={crappy(tick) + 3.5}
					>
						{tick}
					</text>
				))}
				{ticks(0, meanMax, 3).map((tick) => (
					<text
						fill="var(--muted-plot)"
						fontSize={10}
						key={`m${tick}`}
						textAnchor="end"
						x={M.left - 7}
						y={mean(tick) + 3.5}
					>
						{tick}
					</text>
				))}
				<text fill="var(--dim-plot)" fontSize={10.5} x={M.left} y={M.top + 9}>
					functions at CRAP {CRAPPY} or more
				</text>
				<text fill="var(--dim-plot)" fontSize={10.5} x={M.left} y={meanTop - 6}>
					mean CRAP per function
				</text>
				{labels.map((point) => (
					<text
						fill="var(--muted-plot)"
						fontSize={10}
						key={point.generated}
						textAnchor="middle"
						x={x(point.generated)}
						y={H - M.bottom + 22}
					>
						{day(point.generated)}
					</text>
				))}
			</svg>
			{layer}
		</>
	);
}
