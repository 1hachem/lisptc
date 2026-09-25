"use client";

import { TipLine, useTip } from "@/components/tip.tsx";
import { basename, shorten } from "@/lib/format.ts";
import type { Cycle } from "@/lib/report.ts";

const CELL = 250;
const RING = 78;
const NODE = 4.5;

export function Cycles({ cycles }: { cycles: Cycle[] }) {
	const { bind, layer } = useTip();
	if (cycles.length === 0)
		return <p className="m-0 text-dim">no import cycles reported</p>;

	return (
		<>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{cycles.map((cycle) => (
					<Ring bind={bind} cycle={cycle} key={cycle.members.join(">")} />
				))}
			</div>
			{layer}
		</>
	);
}

function Ring({
	cycle,
	bind,
}: {
	cycle: Cycle;
	bind: ReturnType<typeof useTip>["bind"];
}) {
	const n = cycle.members.length;
	const centre = CELL / 2;
	const at = (index: number) => {
		const angle = (index / n) * Math.PI * 2 - Math.PI / 2;
		return {
			x: centre + Math.cos(angle) * RING,
			y: centre + Math.sin(angle) * RING,
		};
	};

	return (
		<figure className="m-0 min-w-0 border border-bg2 bg-bg p-2">
			<figcaption className="mb-1 flex items-baseline justify-between gap-2 px-1">
				<span className="truncate text-[11.5px] text-dim">
					{shorten(cycle.members[0] ?? "")}
				</span>
				<span
					className="shrink-0 text-[11px] tabular-nums"
					style={{ color: "var(--crit)" }}
				>
					{n} files
				</span>
			</figcaption>
			<svg className="block h-auto w-full" viewBox={`0 0 ${CELL} ${CELL}`}>
				<title>{`import cycle of ${n} files`}</title>
				{cycle.members.map((member, index) => {
					const from = at(index);
					const to = at((index + 1) % n);
					const bend = 0.18;
					const mx = (from.x + to.x) / 2 + (to.y - from.y) * bend;
					const my = (from.y + to.y) / 2 - (to.x - from.x) * bend;
					return (
						<path
							d={`M${from.x},${from.y} Q${mx},${my} ${to.x},${to.y}`}
							fill="none"
							key={`${member}-edge`}
							stroke="var(--crit)"
							strokeOpacity={0.5}
							strokeWidth={1.4}
						/>
					);
				})}
				{cycle.members.map((member, index) => {
					const point = at(index);
					const outward = index / n < 0.25 || index / n > 0.75;
					return (
						<g key={member}>
							<circle
								cx={point.x}
								cy={point.y}
								fill="var(--crit)"
								r={NODE}
								stroke="var(--color-bg)"
								strokeWidth={1.5}
								{...bind(
									<TipLine
										name={member}
									>{`step ${index + 1} of ${n}`}</TipLine>,
								)}
							/>
							<text
								fill="var(--dim-plot)"
								fontSize={9}
								textAnchor="middle"
								x={point.x}
								y={point.y + (outward ? -9 : 15)}
							>
								{basename(member)}
							</text>
						</g>
					);
				})}
			</svg>
		</figure>
	);
}
