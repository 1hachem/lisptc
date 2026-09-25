"use client";

import { TipLine, useTip } from "@/components/tip.tsx";
import { count } from "@/lib/format.ts";
import { scale } from "@/lib/plot.ts";
import type { PullRow } from "@/lib/pulls.ts";

const W = 760;
const ROW = 19;
const M = { top: 18, right: 86, bottom: 28, left: 232 };
const TITLE = 34;

function label(row: PullRow): string {
	const title =
		row.title.length > TITLE ? `${row.title.slice(0, TITLE - 1)}…` : row.title;
	return `#${row.number} ${title}`;
}

export function Blast({
	rows,
	workspaces,
}: {
	rows: PullRow[];
	workspaces: number;
}) {
	const { bind, layer } = useTip();
	if (rows.length === 0)
		return <p className="m-0 text-dim">no pull requests in the window</p>;

	const H = M.top + rows.length * ROW + M.bottom;
	const x = scale(0, Math.max(1, workspaces), M.left, W - M.right);
	const step = Math.max(1, Math.ceil(workspaces / 8));
	const marks = Array.from(
		{ length: Math.floor(workspaces / step) + 1 },
		(_, at) => at * step,
	);

	return (
		<>
			<svg
				className="block h-auto w-full min-w-[620px]"
				viewBox={`0 0 ${W} ${H}`}
			>
				<title>
					workspaces each pull request edits, and those that depend on them
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
					const y = M.top + at * ROW;
					const tip = bind(
						<TipLine name={`#${row.number} ${row.title}`}>
							edits {row.touched.length}{" "}
							{row.touched.length === 1 ? "workspace" : "workspaces"} (
							{row.touched.join(", ") || "none"}) · {row.downstream.length}{" "}
							downstream · {count(row.blastFiles)} source files in reach ·{" "}
							{(row.reach * 100).toFixed(0)}% of the repo
						</TipLine>,
					);
					return (
						<g key={row.number} {...tip}>
							<rect fill="transparent" height={ROW} width={W} x={0} y={y} />
							<text
								fill="var(--dim-plot)"
								fontSize={10}
								textAnchor="end"
								x={M.left - 10}
								y={y + ROW / 2 + 3}
							>
								{label(row)}
							</text>
							<rect
								fill="var(--q600)"
								height={ROW - 7}
								width={Math.max(1, x(row.touched.length) - x(0))}
								x={M.left}
								y={y + 3}
							/>
							<rect
								fill="var(--q200)"
								height={ROW - 7}
								width={Math.max(0, x(row.downstream.length) - x(0))}
								x={M.left + (x(row.touched.length) - x(0))}
								y={y + 3}
							/>
							<text
								fill="var(--muted-plot)"
								fontSize={9.5}
								x={W - M.right + 8}
								y={y + ROW / 2 + 3}
							>
								{count(row.blastFiles)} files
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
						y={H - M.bottom + 15}
					>
						{mark}
					</text>
				))}
				<text
					fill="var(--dim-plot)"
					fontSize={10.5}
					textAnchor="middle"
					x={(M.left + W - M.right) / 2}
					y={H - 4}
				>
					workspaces out of {workspaces}
				</text>
			</svg>
			{layer}
		</>
	);
}
