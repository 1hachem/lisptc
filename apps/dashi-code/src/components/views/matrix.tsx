"use client";

import { TipLine, useTip } from "@/components/tip.tsx";
import { count } from "@/lib/format.ts";
import type { Timeline } from "@/lib/git.ts";
import { quant, weekLabel } from "@/lib/plot.ts";

const L = 168;
const T = 34;
const RH = 19;
const SHOWN = 22;

export function Matrix({ timeline }: { timeline: Timeline }) {
	const { bind, layer } = useTip();
	const rows = timeline.packages.slice(0, SHOWN);
	const weeks = timeline.weeks;
	if (rows.length === 0 || weeks.length === 0)
		return <p className="m-0 text-dim">no history</p>;

	const width = 900;
	const cw = Math.max(22, Math.min(46, (width - L - 44) / weeks.length));
	const W = L + weeks.length * cw + 44;
	const H = T + rows.length * RH + 16;
	const hottest = Math.max(...rows.flatMap((row) => row.counts));

	return (
		<>
			<svg
				className="block h-auto w-full min-w-[640px]"
				viewBox={`0 0 ${W} ${H}`}
				aria-label="commits per package per week"
				role="img"
			>
				{weeks.map((week, index) => (
					<text
						fill="var(--muted-plot)"
						fontSize={9.5}
						key={week}
						textAnchor="middle"
						x={L + index * cw + cw / 2}
						y={T - 10}
					>
						{weekLabel(week)}
					</text>
				))}
				<text
					fill="var(--muted-plot)"
					fontSize={9.5}
					x={L + weeks.length * cw + 8}
					y={T - 10}
				>
					tot
				</text>
				{rows.map((row, ri) => {
					const y = T + ri * RH;
					const total = row.counts.reduce((sum, n) => sum + n, 0);
					return (
						<g key={row.key}>
							<text
								fill="var(--dim-plot)"
								fontSize={10.5}
								textAnchor="end"
								x={L - 8}
								y={y + 13}
							>
								{row.key.replace(/^packages\//, "")}
							</text>
							{row.counts.map((value, ci) => (
								<rect
									fill={
										value === 0
											? "var(--color-bg)"
											: quant(0.12 + 0.88 * Math.sqrt(value / hottest))
									}
									height={RH - 2}
									key={weeks[ci]}
									width={cw - 2}
									x={L + ci * cw + 1}
									y={y + 1}
									{...bind(
										<TipLine name={row.key}>
											week of {weeks[ci]} · {value} commits ·{" "}
											{count(row.churn[ci] ?? 0)} lines
										</TipLine>,
									)}
								/>
							))}
							<text
								fill="var(--muted-plot)"
								fontSize={10}
								x={L + weeks.length * cw + 8}
								y={y + 13}
							>
								{total}
							</text>
						</g>
					);
				})}
			</svg>
			{layer}
		</>
	);
}
