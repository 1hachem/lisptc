import { Frame, Legend, Ramp } from "@/components/frame.tsx";
import { Dsm } from "@/components/views/dsm.tsx";
import { Layers } from "@/components/views/layers.tsx";
import type { Snapshot } from "@/lib/snapshot.ts";

export function DependencyFrames({
	compact,
	view,
}: {
	compact: boolean;
	view: Snapshot;
}) {
	const violations = view.edges.filter((edge) => edge.violates);
	return (
		<>
			<Frame
				compact={compact}
				finding={<LayersFinding view={view} />}
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
				finding={<BoundaryFinding view={view} violations={violations} />}
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
		</>
	);
}

function LayersFinding({ view }: { view: Snapshot }) {
	const busiest = mostDependedOn(view);
	if (busiest === null) return null;
	const tags = new Set(view.nodes.map((node) => node.tag));
	return (
		<>
			{view.nodes.length} workspaces over {tags.size} layers and{" "}
			{view.edges.length}
			edges, laid out by the tags <span className="text-fg">turbo.json</span>{" "}
			already declares. <span className="text-fg">{busiest.id}</span> carries
			the graph with {busiest.dependents} dependents.
		</>
	);
}

function BoundaryFinding({
	view,
	violations,
}: {
	view: Snapshot;
	violations: Snapshot["edges"];
}) {
	if (violations.length === 0)
		return (
			<>
				{view.edges.length} edges, zero violations. Every dependency runs
				downward through the declared layering, which is what{" "}
				<span className="text-fg">pnpm boundaries</span> passing looks like.
			</>
		);
	return (
		<>
			{violations.length} edges run against the declared layering:{" "}
			{violations
				.slice(0, 3)
				.map((edge) => `${edge.from} to ${edge.to}`)
				.join(", ")}
			.
		</>
	);
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
