"use client";

import { TipLine, useTip } from "@/components/tip.tsx";
import { count } from "@/lib/format.ts";
import { area, median, scale, ticks, trendColor } from "@/lib/plot.ts";
import type { FileRow } from "@/lib/snapshot.ts";

const W = 760;
const H = 400;
const M = { top: 14, right: 18, bottom: 42, left: 54 };

export function Quadrant({ files }: { files: FileRow[] }) {
	const { bind, layer } = useTip();
	const points = files.filter(
		(file) => file.totCx !== null && file.commits > 0,
	);
	if (points.length === 0)
		return (
			<p className="m-0 text-dim">no complexity data in the last report</p>
		);

	const xmax = Math.max(...points.map((file) => file.commits)) * 1.04;
	const ymax = Math.max(...points.map((file) => file.totCx ?? 0)) * 1.08;
	const lmax = Math.max(...points.map((file) => file.loc ?? 1));
	const x = scale(0, xmax, M.left, W - M.right);
	const y = scale(0, ymax, H - M.bottom, M.top);
	const r = area(lmax, 15);
	const mx = median(points.map((file) => file.commits));
	const my = median(points.map((file) => file.totCx ?? 0));
	const star = points.reduce((high, file) =>
		file.commits * (file.totCx ?? 0) > high.commits * (high.totCx ?? 0)
			? file
			: high,
	);

	return (
		<>
			<svg
				className="block h-auto w-full min-w-[520px]"
				viewBox={`0 0 ${W} ${H}`}
			>
				<title>churn against complexity</title>
				{ticks(0, ymax, 5).map((tick) => (
					<line
						key={tick}
						stroke="var(--grid)"
						x1={M.left}
						x2={W - M.right}
						y1={y(tick)}
						y2={y(tick)}
					/>
				))}
				<line
					stroke="var(--axis)"
					strokeDasharray="3 3"
					x1={x(mx)}
					x2={x(mx)}
					y1={M.top}
					y2={H - M.bottom}
				/>
				<line
					stroke="var(--axis)"
					strokeDasharray="3 3"
					x1={M.left}
					x2={W - M.right}
					y1={y(my)}
					y2={y(my)}
				/>
				<text fill="var(--crit)" fontSize={10} x={x(mx) + 8} y={M.top + 12}>
					refactor first →
				</text>
				{[...points]
					.sort((a, b) => (b.loc ?? 0) - (a.loc ?? 0))
					.map((file) => (
						<circle
							cx={x(file.commits)}
							cy={y(file.totCx ?? 0)}
							fill={trendColor[file.trend] ?? "var(--muted-plot)"}
							fillOpacity={0.55}
							key={file.path}
							r={Math.max(r(file.loc ?? 1), 3.5)}
							stroke="var(--bg1)"
							strokeWidth={1.5}
							{...bind(
								<TipLine name={file.path}>
									{file.commits} commits · cx {file.totCx} (max {file.maxCx}) ·{" "}
									{count(file.loc ?? 0)} lines · {file.trend}
								</TipLine>,
							)}
						/>
					))}
				<text
					fill="var(--fg-plot)"
					fontSize={11}
					textAnchor="end"
					x={x(star.commits) - 16}
					y={y(star.totCx ?? 0) - 4}
				>
					{star.path.split("/").pop()}
				</text>
				<line
					stroke="var(--axis)"
					x1={M.left}
					x2={W - M.right}
					y1={H - M.bottom}
					y2={H - M.bottom}
				/>
				<line
					stroke="var(--axis)"
					x1={M.left}
					x2={M.left}
					y1={M.top}
					y2={H - M.bottom}
				/>
				{ticks(0, xmax, 6).map((tick) => (
					<text
						fill="var(--muted-plot)"
						fontSize={10.5}
						key={tick}
						textAnchor="middle"
						x={x(tick)}
						y={H - M.bottom + 15}
					>
						{count(tick)}
					</text>
				))}
				{ticks(0, ymax, 5).map((tick) => (
					<text
						fill="var(--muted-plot)"
						fontSize={10.5}
						key={tick}
						textAnchor="end"
						x={M.left - 7}
						y={y(tick) + 3.5}
					>
						{count(tick)}
					</text>
				))}
				<text
					fill="var(--dim-plot)"
					fontSize={11}
					textAnchor="middle"
					x={(M.left + W - M.right) / 2}
					y={H - 7}
				>
					commits touching the file
				</text>
				<text
					fill="var(--dim-plot)"
					fontSize={11}
					textAnchor="middle"
					transform={`rotate(-90 16 ${(M.top + H - M.bottom) / 2})`}
					x={16}
					y={(M.top + H - M.bottom) / 2}
				>
					cyclomatic complexity, file total
				</text>
			</svg>
			{layer}
		</>
	);
}
