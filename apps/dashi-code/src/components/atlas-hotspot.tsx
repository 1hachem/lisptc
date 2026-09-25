import { Frame, Legend } from "@/components/frame.tsx";
import { Quadrant } from "@/components/views/quadrant.tsx";
import { shorten } from "@/lib/format.ts";
import { trendColor } from "@/lib/plot.ts";
import type { FileRow } from "@/lib/snapshot.ts";

export function HotspotFrame({
	compact,
	files,
}: {
	compact: boolean;
	files: FileRow[];
}) {
	const worst = files
		.filter((file) => file.totCx !== null)
		.reduce<FileRow | undefined>(
			(high, file) => (hotter(high, file) ? file : high),
			undefined,
		);
	return (
		<Frame
			compact={compact}
			finding={worst === undefined ? null : <HotspotFinding file={worst} />}
			name="Hotspot quadrant"
			spec={{
				input: "git log --numstat per file, joined to the last fallow report",
				ceiling: "~2,000 points before overplot; then bin or facet",
				fails: "you read it as a ranking rather than a triage",
			}}
			tags={["scatter", "git × AST"]}
			why={
				<>
					Churn on one axis, complexity on the other. The top-right quadrant is
					the only place refactoring pays for itself: code that is hard to
					understand <em>and</em> changing constantly. Dashed lines are the
					medians.
				</>
			}
		>
			<Quadrant files={files} />
			<Legend
				items={[
					{ color: trendColor.accelerating ?? "", label: "accelerating" },
					{ color: trendColor.stable ?? "", label: "stable" },
					{ color: trendColor.cooling ?? "", label: "cooling" },
				]}
			/>
		</Frame>
	);
}

function hotter(high: FileRow | undefined, file: FileRow): boolean {
	return (
		high === undefined ||
		file.commits * (file.totCx ?? 0) > high.commits * (high.totCx ?? 0)
	);
}

function HotspotFinding({ file }: { file: FileRow }) {
	return (
		<>
			<span className="text-fg">{shorten(file.path)}</span> owns this chart:{" "}
			{file.commits} commits against cyclomatic {file.totCx} across {file.fns}{" "}
			functions, worst one at {file.maxCx}. It is {file.trend}.
		</>
	);
}
