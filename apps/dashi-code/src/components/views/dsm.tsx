"use client";

import { TipLine, useTip } from "@/components/tip.tsx";
import { quant } from "@/lib/plot.ts";
import type { Snapshot } from "@/lib/snapshot.ts";

const L = 150;
const T = 108;
const C = 20;

export function Dsm({
	nodes,
	edges,
	layers,
}: {
	nodes: Snapshot["nodes"];
	edges: Snapshot["edges"];
	layers: string[];
}) {
	const { bind, layer } = useTip();
	const ordered = [...nodes].sort(
		(a, b) =>
			layers.indexOf(a.tag) - layers.indexOf(b.tag) ||
			a.dir.localeCompare(b.dir),
	);
	const n = ordered.length;
	if (n === 0) return <p className="m-0 text-dim">no workspaces</p>;

	const W = L + n * C + 16;
	const H = T + n * C + 16;
	const held = new Set(edges.map((edge) => `${edge.from}>${edge.to}`));
	const violating = new Set(
		edges
			.filter((edge) => edge.violates)
			.map((edge) => `${edge.from}>${edge.to}`),
	);
	const fanIn = ordered.map(
		(node) => edges.filter((edge) => edge.to === node.id).length,
	);
	const busiest = Math.max(...fanIn, 1);

	return (
		<>
			<svg
				className="block h-auto w-full min-w-[620px]"
				viewBox={`0 0 ${W} ${H}`}
			>
				<title>which package depends on which</title>
				{ordered.map((node, index) => (
					<g key={node.dir}>
						<text
							fill="var(--dim-plot)"
							fontSize={9.5}
							textAnchor="end"
							x={L - 7}
							y={T + index * C + 14}
						>
							{node.dir.replace(/^packages\//, "")}
						</text>
						<text
							fill="var(--dim-plot)"
							fontSize={9.5}
							transform={`rotate(-55 ${L + index * C + 14} ${T - 7})`}
							x={L + index * C + 14}
							y={T - 7}
						>
							{node.dir.replace(/^packages\//, "")}
						</text>
					</g>
				))}
				{ordered.flatMap((row, r) =>
					ordered.map((column, c) => {
						const x = L + c * C;
						const y = T + r * C;
						if (r === c)
							return (
								<rect
									fill="var(--axis)"
									fillOpacity={0.5}
									height={C - 2}
									key={`${row.id}-${column.id}`}
									width={C - 2}
									x={x + 1}
									y={y + 1}
								/>
							);
						const key = `${row.id}>${column.id}`;
						if (!held.has(key))
							return (
								<rect
									fill="var(--color-bg)"
									height={C - 2}
									key={key}
									width={C - 2}
									x={x + 1}
									y={y + 1}
								/>
							);
						const wrong = violating.has(key) || c < r;
						return (
							<rect
								fill={
									wrong
										? "var(--crit)"
										: quant(0.35 + 0.55 * ((fanIn[c] ?? 0) / busiest))
								}
								height={C - 2}
								key={key}
								width={C - 2}
								x={x + 1}
								y={y + 1}
								{...bind(
									<TipLine name={`${row.id} → ${column.id}`}>
										{wrong
											? "against the declared direction"
											: "declared dependency"}
									</TipLine>,
								)}
							/>
						);
					}),
				)}
				<line
					stroke="var(--fg-plot)"
					strokeOpacity={0.35}
					strokeWidth={1.2}
					x1={L}
					x2={L + n * C}
					y1={T}
					y2={T + n * C}
				/>
				<text
					fill="var(--muted-plot)"
					fontSize={10}
					textAnchor="end"
					x={L + n * C - 4}
					y={T + 16}
				>
					above the diagonal = legal direction
				</text>
				<text
					fill="var(--muted-plot)"
					fontSize={10}
					x={L + 6}
					y={T + n * C - 6}
				>
					below = back edge
				</text>
			</svg>
			{layer}
		</>
	);
}
