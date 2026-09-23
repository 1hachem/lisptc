import { Fragment, type ReactNode } from "react";
import { LayersFrame, MatrixFrame } from "@/components/atlas-dependencies.tsx";
import { HotspotFrame } from "@/components/atlas-hotspot.tsx";
import { ActivityFrame, CycleFrame } from "@/components/atlas-timeline.tsx";
import { TreemapFrame } from "@/components/atlas-treemap.tsx";
import { Frame, Legend } from "@/components/frame.tsx";
import { Stat, Stats } from "@/components/ui.tsx";
import { Arcs } from "@/components/views/arcs.tsx";
import { count } from "@/lib/format.ts";
import type { FileRow, Snapshot } from "@/lib/snapshot.ts";

export interface AtlasPanel {
	key: string;
	node: ReactNode;
}

export function atlasPanels(view: Snapshot, compact: boolean): AtlasPanel[] {
	const code = view.files.filter((file) => file.tracked);
	return [
		{
			key: "stats",
			node: (
				<Stats>
					<Stat
						label="commits"
						note={`${view.authors} authors`}
						value={count(view.commits)}
					/>
					<CodeStats files={code} workspaces={view.nodes.length} />
					<Stat
						label="import cycles"
						note={
							view.cycles.length === 0 ? "none reported" : "each drawn below"
						}
						tone={view.cycles.length === 0 ? "neutral" : "red"}
						value={count(view.cycles.length)}
					/>
				</Stats>
			),
		},
		{
			key: "hotspots",
			node: <HotspotFrame compact={compact} files={code} />,
		},
		{
			key: "treemap",
			node: <TreemapFrame compact={compact} files={code} />,
		},
		{
			key: "activity",
			node: <ActivityFrame compact={compact} view={view} />,
		},
		{
			key: "layers",
			node: <LayersFrame compact={compact} view={view} />,
		},
		{
			key: "matrix",
			node: <MatrixFrame compact={compact} view={view} />,
		},
		{
			key: "cycles",
			node: <CycleFrame compact={compact} view={view} />,
		},
		{
			key: "arcs",
			node: <ArcsFrame compact={compact} view={view} />,
		},
	];
}

export function Atlas({
	view,
	compact = false,
}: {
	view: Snapshot;
	compact?: boolean;
}) {
	return (
		<>
			{atlasPanels(view, compact).map((panel) => (
				<Fragment key={panel.key}>{panel.node}</Fragment>
			))}
		</>
	);
}

function ArcsFrame({ compact, view }: { compact: boolean; view: Snapshot }) {
	return (
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
					Two packages that always change in the same commit are coupled whether
					or not either imports the other. This graph comes only from git
					history, and it routinely finds coupling the import graph cannot see.
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
	);
}

function CodeStats({
	files,
	workspaces,
}: {
	files: FileRow[];
	workspaces: number;
}) {
	const source = files.filter((file) => !file.isTest);
	const lines = source.reduce((sum, file) => sum + (file.loc ?? 0), 0);
	return (
		<>
			<Stat
				label="source files"
				note={`${count(files.length - source.length)} tests`}
				value={count(source.length)}
			/>
			<Stat
				label="lines"
				note={`${workspaces} workspaces`}
				value={`${(lines / 1000).toFixed(1)}k`}
			/>
		</>
	);
}
