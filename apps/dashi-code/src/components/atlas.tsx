import { Frame, Legend, Ramp } from "@/components/frame.tsx";
import { Stat, Stats } from "@/components/ui.tsx";
import { Arcs } from "@/components/views/arcs.tsx";
import { Cycles } from "@/components/views/cycles.tsx";
import { Dsm } from "@/components/views/dsm.tsx";
import { Layers } from "@/components/views/layers.tsx";
import { Matrix } from "@/components/views/matrix.tsx";
import { Quadrant } from "@/components/views/quadrant.tsx";
import { Treemap } from "@/components/views/treemap.tsx";
import { count, shorten } from "@/lib/format.ts";
import { trendColor } from "@/lib/plot.ts";
import type { FileRow, Snapshot } from "@/lib/snapshot.ts";

export function Atlas({
	view,
	compact = false,
}: {
	view: Snapshot;
	compact?: boolean;
}) {
	const code = view.files.filter((file) => file.tracked);
	const source = code.filter((file) => !file.isTest);
	const lines = source.reduce((sum, file) => sum + (file.loc ?? 0), 0);
	const worst = code
		.filter((file) => file.totCx !== null)
		.reduce<FileRow | undefined>(
			(high, file) =>
				high === undefined ||
				file.commits * (file.totCx ?? 0) > high.commits * (high.totCx ?? 0)
					? file
					: high,
			undefined,
		);
	const violations = view.edges.filter((edge) => edge.violates);
	const byLoc = [...code].sort((a, b) => (b.loc ?? 0) - (a.loc ?? 0))[0];
	const byChurn = [...code].sort((a, b) => b.commits - a.commits)[0];
	const weeks = view.timeline.weeks.length;
	const early = leader(view, 0, Math.ceil(weeks / 3));
	const late = leader(view, weeks - Math.ceil(weeks / 3), weeks);
	const tangled = view.cycles[0];
	const tags = new Set(view.nodes.map((node) => node.tag));
	const busiest = mostDependedOn(view);

	return (
		<>
			<Stats>
				<Stat
					label="commits"
					note={`${view.authors} authors`}
					value={count(view.commits)}
				/>
				<Stat
					label="source files"
					note={`${count(code.length - source.length)} tests`}
					value={count(source.length)}
				/>
				<Stat
					label="lines"
					note={`${view.nodes.length} workspaces`}
					value={`${(lines / 1000).toFixed(1)}k`}
				/>
				<Stat
					label="import cycles"
					note={view.cycles.length === 0 ? "none reported" : "each drawn below"}
					tone={view.cycles.length === 0 ? "neutral" : "red"}
					value={count(view.cycles.length)}
				/>
			</Stats>

			<Frame
				compact={compact}
				finding={
					worst === undefined ? null : (
						<>
							<span className="text-fg">{shorten(worst.path)}</span> owns this
							chart: {worst.commits} commits against cyclomatic {worst.totCx}{" "}
							across {worst.fns} functions, worst one at {worst.maxCx}. It is{" "}
							{worst.trend}.
						</>
					)
				}
				name="Hotspot quadrant"
				spec={{
					input: "git log --numstat per file, joined to the last fallow report",
					ceiling: "~2,000 points before overplot; then bin or facet",
					fails: "you read it as a ranking rather than a triage",
				}}
				tags={["scatter", "git × AST"]}
				why={
					<>
						Churn on one axis, complexity on the other. The top-right quadrant
						is the only place refactoring pays for itself: code that is hard to
						understand <em>and</em> changing constantly. Dashed lines are the
						medians.
					</>
				}
			>
				<Quadrant files={code} />
				<Legend
					items={[
						{ color: trendColor.accelerating ?? "", label: "accelerating" },
						{ color: trendColor.stable ?? "", label: "stable" },
						{ color: trendColor.cooling ?? "", label: "cooling" },
					]}
				/>
			</Frame>

			<Frame
				compact={compact}
				finding={
					byLoc === undefined || byChurn === undefined ? null : (
						<>
							Size and heat disagree. The largest file is{" "}
							<span className="text-fg">{shorten(byLoc.path)}</span> at{" "}
							{count(byLoc.loc ?? 0)} lines and {byLoc.commits} commits; the
							most edited is{" "}
							<span className="text-fg">{shorten(byChurn.path)}</span> at{" "}
							{byChurn.commits} commits and {count(byChurn.loc ?? 0)} lines.
						</>
					)
				}
				name="Nested treemap"
				spec={{
					input: "a path to line-count map plus commits per path",
					ceiling: "~5,000 leaves before tiles fall under a pixel",
					fails: "you compare areas of non-adjacent tiles",
				}}
				tags={["enclosure", "lines × churn"]}
				why={
					<>
						Area carries size, colour carries churn, nesting carries the
						workspace. Every source file in the repo, no scrolling and no
						truncation, which is exactly what a ranked table cannot do.
					</>
				}
			>
				<Treemap files={code} />
				<Ramp high="most edited" low="1 commit" />
			</Frame>

			<Frame
				compact={compact}
				finding={
					early === null || late === null ? null : (
						<>
							The centre of gravity moved. Over the first third of the window{" "}
							<span className="text-fg">{shorten(early.key)}</span> led with{" "}
							{early.total} commits; over the last third it is{" "}
							<span className="text-fg">{shorten(late.key)}</span> with{" "}
							{late.total}.
						</>
					)
				}
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

			<Frame
				compact={compact}
				finding={
					busiest === null ? null : (
						<>
							{view.nodes.length} workspaces over {tags.size} layers and{" "}
							{view.edges.length} edges, laid out by the tags{" "}
							<span className="text-fg">turbo.json</span> already declares.{" "}
							<span className="text-fg">{busiest.id}</span> carries the graph
							with {busiest.dependents} dependents.
						</>
					)
				}
				name="Layered dependency graph"
				spec={{
					input: "workspace dependencies plus each package's turbo tag",
					ceiling:
						"~60 nodes and ~200 edges, then read the matrix below instead",
					fails: "the nodes have no natural layer, leaving a prettier hairball",
				}}
				tags={["Sugiyama DAG", "node-link"]}
				why={
					<>
						A force layout of this many nodes is a hairball. Pinning every node
						to the layer the architecture already declares, then ordering within
						the layer to cut crossings, makes the same edges readable. A
						violation is an edge that climbs.
					</>
				}
			>
				<Layers edges={view.edges} layers={view.layers} nodes={view.nodes} />
				<Legend
					items={[
						{
							color: "var(--s1)",
							label: "dependency, running down",
							line: true,
						},
						{
							color: "var(--crit)",
							label:
								violations.length === 0
									? "layer violation, none present"
									: `layer violation, ${violations.length} present`,
							line: true,
						},
					]}
				/>
			</Frame>

			<Frame
				compact={compact}
				finding={
					violations.length === 0 ? (
						<>
							{view.edges.length} edges, zero violations. Every dependency runs
							downward through the declared layering, which is what{" "}
							<span className="text-fg">pnpm boundaries</span> passing looks
							like.
						</>
					) : (
						<>
							{violations.length} edges run against the declared layering:{" "}
							{violations
								.slice(0, 3)
								.map((edge) => `${edge.from} to ${edge.to}`)
								.join(", ")}
							.
						</>
					)
				}
				name="Dependency structure matrix"
				spec={{
					input: "workspace dependencies plus each package's turbo tag",
					ceiling: "~150 × 150, far past where a node-link diagram collapses",
					fails: "the axes are sorted alphabetically, losing the triangle",
				}}
				tags={["DSM", "adjacency"]}
				why={
					<>
						The same edges as a grid, axes ordered by layer. A clean
						architecture puts every mark on one side of the diagonal, so a
						violation is not an edge to hunt for in a tangle, it is a mark in
						the empty triangle.
					</>
				}
			>
				<Dsm edges={view.edges} layers={view.layers} nodes={view.nodes} />
				<Ramp high="by many" low="depended on by few" />
			</Frame>

			<Frame
				compact={compact}
				finding={
					tangled === undefined ? (
						<>
							No import cycle in the last analysis. The panel stays so the first
							one cannot hide inside the dependency graph.
						</>
					) : (
						<>
							{view.cycles.length}{" "}
							{view.cycles.length === 1 ? "cycle" : "cycles"}. The longest runs
							through {tangled.length} files, starting at{" "}
							<span className="text-fg">{tangled.members[0] ?? ""}</span>. A
							cycle is the one dependency problem the matrix cannot show,
							because every edge in it is legal on its own.
						</>
					)
				}
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

			<Frame
				compact={compact}
				name="Temporal coupling arcs"
				spec={{
					input: "commit to file sets, normalised by the smaller commit count",
					ceiling: "~80 arcs before it turns to soup",
					fails: "sweeping commits are not excluded, coupling everything",
				}}
				tags={["arc diagram", "git only"]}
				why={
					<>
						Two packages that always change in the same commit are coupled
						whether or not either imports the other. This graph comes only from
						git history, and it routinely finds coupling the import graph cannot
						see.
					</>
				}
			>
				<Arcs
					edges={view.edges}
					layers={view.layers}
					nodes={view.nodes}
					pairs={view.cochange.packages}
				/>
				<Legend
					items={[
						{
							color: "var(--s2)",
							label: "coupled in git, no import",
							line: true,
						},
						{ color: "var(--s1)", label: "coupled and imported", line: true },
					]}
				/>
			</Frame>
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

function mostDependedOn(
	view: Snapshot,
): { id: string; dependents: number } | null {
	const counted = view.nodes.map((node) => ({
		id: node.id,
		dependents: view.edges.filter((edge) => edge.to === node.id).length,
	}));
	const top = counted.sort((a, b) => b.dependents - a.dependents)[0];
	return top === undefined || top.dependents === 0 ? null : top;
}
