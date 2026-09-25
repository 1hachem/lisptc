"use client";

import { TipLine, useTip } from "@/components/tip.tsx";
import type { Pair } from "@/lib/git.ts";
import { scale } from "@/lib/plot.ts";
import type { Snapshot } from "@/lib/snapshot.ts";

const W = 760;
const AH = 190;
const H = AH + 96;

export function Arcs({
	pairs,
	nodes,
	edges,
	layers,
}: {
	pairs: Pair[];
	nodes: Snapshot["nodes"];
	edges: Snapshot["edges"];
	layers: string[];
}) {
	const { bind, layer } = useTip();
	const dirOf = new Map(nodes.map((node) => [node.id, node.dir]));
	const imported = new Set(
		edges.flatMap((edge) => {
			const from = dirOf.get(edge.from);
			const to = dirOf.get(edge.to);
			return from === undefined || to === undefined
				? []
				: [`${from}|${to}`, `${to}|${from}`];
		}),
	);

	const ordered = [...nodes]
		.sort(
			(a, b) =>
				layers.indexOf(a.tag) - layers.indexOf(b.tag) ||
				a.dir.localeCompare(b.dir),
		)
		.filter((node) =>
			pairs.some((pair) => pair.a === node.dir || pair.b === node.dir),
		);
	if (ordered.length === 0 || pairs.length === 0)
		return <p className="m-0 text-dim">no co-change above the threshold</p>;

	const x = scale(0, ordered.length - 1, 38, W - 38);
	const at = new Map(ordered.map((node, index) => [node.dir, x(index)]));
	const strongest = Math.max(...pairs.map((pair) => pair.strength));
	const hidden = pairs.filter(
		(pair) => !imported.has(`${pair.a}|${pair.b}`),
	).length;

	return (
		<>
			<svg
				className="block h-auto w-full min-w-[560px]"
				viewBox={`0 0 ${W} ${H}`}
			>
				<title>packages that change together</title>
				<line stroke="var(--axis)" x1={12} x2={W - 12} y1={AH} y2={AH} />
				{[...pairs]
					.sort((a, b) => a.strength - b.strength)
					.map((pair) => {
						const a = at.get(pair.a);
						const b = at.get(pair.b);
						if (a === undefined || b === undefined) return null;
						const lift = Math.min(Math.abs(b - a) / 2, AH - 14);
						const isHidden = !imported.has(`${pair.a}|${pair.b}`);
						return (
							<path
								d={`M${a},${AH} C${a},${AH - lift * 1.1} ${b},${AH - lift * 1.1} ${b},${AH}`}
								fill="none"
								key={`${pair.a}-${pair.b}`}
								stroke={isHidden ? "var(--s2)" : "var(--s1)"}
								strokeOpacity={0.55}
								strokeWidth={0.9 + 3.4 * (pair.strength / strongest)}
								{...bind(
									<TipLine name={`${pair.a} ↔ ${pair.b}`}>
										{pair.together} shared commits · strength {pair.strength} ·{" "}
										{isHidden
											? "no import between them"
											: "also an import edge"}
									</TipLine>,
								)}
							/>
						);
					})}
				{ordered.map((node, index) => (
					<g key={node.dir}>
						<circle cx={x(index)} cy={AH} fill="var(--fg-plot)" r={3.4} />
						<text
							fill="var(--dim-plot)"
							fontSize={9.5}
							transform={`rotate(55 ${x(index)} ${AH + 10})`}
							x={x(index)}
							y={AH + 10}
						>
							{node.dir.replace(/^packages\//, "")}
						</text>
					</g>
				))}
			</svg>
			<p className="m-0 px-1 pt-2 text-[11.5px] text-dim">
				{hidden} of {pairs.length} coupled pairs have no import between them.
				Arc thickness is coupling strength; commits touching more than 25 files
				are excluded.
			</p>
			{layer}
		</>
	);
}
