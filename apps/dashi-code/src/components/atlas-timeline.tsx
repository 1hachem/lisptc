import { Frame, Ramp } from "@/components/frame.tsx";
import { Cycles } from "@/components/views/cycles.tsx";
import { Matrix } from "@/components/views/matrix.tsx";
import { shorten } from "@/lib/format.ts";
import type { Snapshot } from "@/lib/snapshot.ts";

export function ActivityFrame({
	compact,
	view,
}: {
	compact: boolean;
	view: Snapshot;
}) {
	const weeks = view.timeline.weeks.length;
	const early = leader(view, 0, Math.ceil(weeks / 3));
	const late = leader(view, weeks - Math.ceil(weeks / 3), weeks);
	return (
		<Frame
			compact={compact}
			finding={<ActivityFinding early={early} late={late} />}
			name="Activity matrix"
			spec={{
				input: "commits bucketed by package and week",
				ceiling: "~60 rows on screen, sorted by volume rather than name",
				fails: "rows are alphabetical, so the quiet ones never sink",
			}}
			tags={["heatmap", "entity × time"]}
			why={
				<>
					One row per package, one column per week, counted once per commit
					rather than once per file. The eye picks out sustained bands,
					repo-wide sweeps, and the rows that simply stop.
				</>
			}
		>
			<Matrix timeline={view.timeline} />
			<Ramp high="busiest week" low="quiet" />
		</Frame>
	);
}

function ActivityFinding({
	early,
	late,
}: {
	early: { key: string; total: number } | null;
	late: { key: string; total: number } | null;
}) {
	if (early === null || late === null) return null;
	return (
		<>
			The centre of gravity moved. Over the first third of the window{" "}
			<span className="text-fg">{shorten(early.key)}</span> led with{" "}
			{early.total} commits; over the last third it is{" "}
			<span className="text-fg">{shorten(late.key)}</span> with {late.total}.
		</>
	);
}

function leader(
	view: Snapshot,
	from: number,
	to: number,
): { key: string; total: number } | null {
	const totals = view.timeline.packages.map((row) => ({
		key: row.key,
		total: row.counts.slice(from, to).reduce((sum, n) => sum + n, 0),
	}));
	const top = totals.sort((a, b) => b.total - a.total)[0];
	return top === undefined || top.total === 0 ? null : top;
}

export function CycleFrame({
	compact,
	view,
}: {
	compact: boolean;
	view: Snapshot;
}) {
	return (
		<Frame
			compact={compact}
			finding={<CycleFinding view={view} />}
			name="Import cycles"
			spec={{
				input: "the circular dependencies fallow reports, one ring per cycle",
				ceiling: "a few dozen rings before the grid needs paging",
				fails: "you draw them inside the main graph, where they vanish",
			}}
			tags={["small multiples", "SCC"]}
			why={
				<>
					Each cycle gets its own ring rather than being smeared across the
					dependency graph. Every edge in a cycle looks fine in isolation, so
					the only way to see one is to isolate the loop and follow it round.
				</>
			}
		>
			<Cycles cycles={view.cycles} />
		</Frame>
	);
}

function CycleFinding({ view }: { view: Snapshot }) {
	const longest = view.cycles[0];
	if (longest === undefined)
		return (
			<>
				No import cycle in the last analysis. The panel stays so the first one
				cannot hide inside the dependency graph.
			</>
		);
	return (
		<>
			{view.cycles.length} {view.cycles.length === 1 ? "cycle" : "cycles"}. The
			longest runs through {longest.length} files, starting at{" "}
			<span className="text-fg">{longest.members[0] ?? ""}</span>. A cycle is
			the one dependency problem the matrix cannot show, because every edge in
			it is legal on its own.
		</>
	);
}
