"use client";

import { useState } from "react";
import { TipLine, useTip } from "@/components/tip.tsx";
import { shorten } from "@/lib/format.ts";
import type { Snapshot } from "@/lib/snapshot.ts";

const W = 760;
const LH = 62;
const BOX = 28;
const GAP = 8;
const LABEL = 140;
const SWEEPS = 6;
const HEAD = 6;

type Node = Snapshot["nodes"][number];
type Placed = { node: Node; x: number; y: number; w: number };

export function Layers({
	nodes,
	edges,
	layers,
}: {
	nodes: Snapshot["nodes"];
	edges: Snapshot["edges"];
	layers: string[];
}) {
	const { bind, layer } = useTip();
	const [held, setHeld] = useState<string | null>(null);
	if (nodes.length === 0) return <p className="m-0 text-dim">no workspaces</p>;

	const rows = rowsOf(nodes, layers);
	const sorted = sweep(rows, edges);
	const placed = place(sorted);
	const at = new Map(placed.map((one) => [one.node.id, one]));
	const H = rows.length * LH + 30;
	const drawn = edges.filter(
		(edge) => at.has(edge.from) && at.has(edge.to) && edge.from !== edge.to,
	);
	const before = crossings(place(rows), edges);
	const after = crossings(placed, edges);

	const dependents = new Map<string, number>();
	for (const edge of edges)
		dependents.set(edge.to, (dependents.get(edge.to) ?? 0) + 1);

	return (
		<>
			<svg
				className="block h-auto w-full min-w-[620px]"
				viewBox={`0 0 ${W} ${H}`}
				aria-label="every workspace dependency, layer by layer"
				role="img"
			>
				<defs>
					<marker
						id="layers-arrow"
						markerHeight={6}
						markerUnits="userSpaceOnUse"
						markerWidth={6}
						orient="auto"
						refX={6}
						refY={3}
					>
						<path d="M0,0 L6,3 L0,6 z" fill="context-stroke" />
					</marker>
				</defs>
				{sorted.map((row, index) => {
					const y = 18 + (sorted.length - 1 - index) * LH;
					return (
						<g key={row[0]?.tag ?? index}>
							<text
								fill="var(--dim-plot)"
								fontSize={11}
								textAnchor="end"
								x={LABEL - 12}
								y={y + 20}
							>
								{row[0]?.tag ?? ""}
							</text>
							<line
								stroke="var(--axis)"
								strokeOpacity={0.6}
								x1={LABEL}
								x2={W - 10}
								y1={y + BOX + 4}
								y2={y + BOX + 4}
							/>
						</g>
					);
				})}
				{drawn.map((edge) => (
					<EdgePath
						at={at}
						edge={edge}
						held={held}
						key={`${edge.from}>${edge.to}`}
					/>
				))}
				{placed.map((one) => {
					const name = shorten(one.node.dir);
					const tip = bind(
						<TipLine name={one.node.id}>
							{one.node.tag} · {one.node.deps.length} deps ·{" "}
							{dependents.get(one.node.id) ?? 0} dependents
						</TipLine>,
					);
					return (
						<g
							key={one.node.id}
							{...tip}
							onPointerEnter={(event) => {
								tip.onPointerEnter(event);
								setHeld(one.node.id);
							}}
							onPointerLeave={() => {
								tip.onPointerLeave();
								setHeld(null);
							}}
						>
							<rect
								fill="var(--color-bg)"
								height={BOX}
								rx={3}
								stroke={held === one.node.id ? "var(--fg-plot)" : "var(--axis)"}
								strokeWidth={held === one.node.id ? 2 : 1}
								width={one.w}
								x={one.x - one.w / 2}
								y={one.y}
							/>
							<text
								fill="var(--dim-plot)"
								fontSize={9.5}
								textAnchor="middle"
								x={one.x}
								y={one.y + 17.5}
							>
								{name.length > 11 ? `${name.slice(0, 10)}…` : name}
							</text>
						</g>
					);
				})}
			</svg>
			<p className="m-0 px-1 pt-2 text-[11.5px] text-dim">
				{drawn.length} edges over {sorted.length} layers, each arrow pointing
				from a package to what it depends on. Ordering each layer by the
				barycentre of its neighbours cuts crossings from {before} to {after}.
				Hover a package to isolate its edges.
			</p>
			{layer}
		</>
	);
}

function EdgePath({
	at,
	edge,
	held,
}: {
	at: Map<string, Placed>;
	edge: Snapshot["edges"][number];
	held: string | null;
}) {
	const from = at.get(edge.from);
	const to = at.get(edge.to);
	if (from === undefined || to === undefined) return null;
	const level = to.y === from.y;
	const down = to.y > from.y;
	const { start, end } = edgeEnds(from, to, level, down);
	const lit = edgeIsLit(edge, held);
	return (
		<path
			d={`M${from.x},${start} C${from.x},${(start + end) / 2} ${to.x},${(start + end) / 2} ${to.x},${end}`}
			fill="none"
			markerEnd="url(#layers-arrow)"
			opacity={lit ? (held === null ? 0.28 : 1) : 0.05}
			stroke={edge.violates ? "var(--crit)" : "var(--s1)"}
			strokeWidth={edge.violates || held !== null ? 1.8 : 1}
		/>
	);
}

function edgeEnds(
	from: Placed,
	to: Placed,
	level: boolean,
	down: boolean,
): { start: number; end: number } {
	const start = level || down ? from.y + BOX : from.y;
	const end = down ? to.y - HEAD : to.y + BOX + HEAD;
	return {
		start,
		end: level ? start + LH / 3 : end,
	};
}

function edgeIsLit(
	edge: Snapshot["edges"][number],
	held: string | null,
): boolean {
	return held === null || held === edge.from || held === edge.to;
}

function rowsOf(nodes: Snapshot["nodes"], layers: string[]): Node[][] {
	const rank = (tag: string) => {
		const found = layers.indexOf(tag);
		return found < 0 ? layers.length : found;
	};
	const byTag = new Map<string, Node[]>();
	for (const node of nodes)
		byTag.set(node.tag, [...(byTag.get(node.tag) ?? []), node]);
	return [...byTag.entries()]
		.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
		.map(([, row]) => [...row].sort((a, b) => a.dir.localeCompare(b.dir)));
}

function sweep(rows: Node[][], edges: Snapshot["edges"]): Node[][] {
	const neighbours = new Map<string, string[]>();
	const link = (a: string, b: string) =>
		neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
	for (const edge of edges) {
		link(edge.from, edge.to);
		link(edge.to, edge.from);
	}

	let current = rows;
	for (let pass = 0; pass < SWEEPS; pass += 1) {
		const at = new Map<string, number>();
		for (const row of current)
			for (const [index, node] of row.entries())
				at.set(node.id, (index + 0.5) / row.length);
		current = current.map((row) =>
			[...row].sort(
				(a, b) =>
					barycentre(a, at, neighbours) - barycentre(b, at, neighbours) ||
					a.dir.localeCompare(b.dir),
			),
		);
	}
	return current;
}

function barycentre(
	node: Node,
	at: Map<string, number>,
	neighbours: Map<string, string[]>,
): number {
	const seen = (neighbours.get(node.id) ?? []).flatMap((id) => {
		const found = at.get(id);
		return found === undefined ? [] : [found];
	});
	return seen.length === 0
		? (at.get(node.id) ?? 0.5)
		: seen.reduce((sum, one) => sum + one, 0) / seen.length;
}

function place(rows: Node[][]): Placed[] {
	return rows.flatMap((row, index) => {
		const y = 18 + (rows.length - 1 - index) * LH;
		const span = W - LABEL - 10;
		const w = Math.min(88, (span - (row.length - 1) * GAP) / row.length);
		const total = row.length * w + (row.length - 1) * GAP;
		const left = LABEL + (span - total) / 2;
		return row.map((node, column) => ({
			node,
			w,
			y,
			x: left + column * (w + GAP) + w / 2,
		}));
	});
}

function crossings(placed: Placed[], edges: Snapshot["edges"]): number {
	const at = new Map(placed.map((one) => [one.node.id, one]));
	return crossingSpans(
		edges.flatMap((edge) => {
			const from = at.get(edge.from);
			const to = at.get(edge.to);
			return from === undefined || to === undefined || from.y === to.y
				? []
				: [{ top: from.y, bottom: to.y, a: from.x, b: to.x }];
		}),
	);
}

function crossingSpans(
	spans: { top: number; bottom: number; a: number; b: number }[],
): number {
	let total = 0;
	for (let i = 0; i < spans.length; i += 1) {
		const one = spans[i];
		if (one === undefined) continue;
		for (let j = i + 1; j < spans.length; j += 1) {
			const other = spans[j];
			if (other === undefined) continue;
			if (one.top !== other.top || one.bottom !== other.bottom) continue;
			if ((one.a - other.a) * (one.b - other.b) < 0) total += 1;
		}
	}
	return total;
}
