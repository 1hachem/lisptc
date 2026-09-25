import { Frame, Ramp } from "@/components/frame.tsx";
import { Treemap } from "@/components/views/treemap.tsx";
import { count, shorten } from "@/lib/format.ts";
import type { FileRow } from "@/lib/snapshot.ts";

export function TreemapFrame({
	compact,
	files,
}: {
	compact: boolean;
	files: FileRow[];
}) {
	const largest = [...files].sort((a, b) => (b.loc ?? 0) - (a.loc ?? 0))[0];
	const busiest = [...files].sort((a, b) => b.commits - a.commits)[0];
	return (
		<Frame
			compact={compact}
			finding={
				largest === undefined || busiest === undefined ? null : (
					<TreemapFinding largest={largest} busiest={busiest} />
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
			<Treemap files={files} />
			<Ramp high="most edited" low="1 commit" />
		</Frame>
	);
}

function TreemapFinding({
	largest,
	busiest,
}: {
	largest: FileRow;
	busiest: FileRow;
}) {
	return (
		<>
			Size and heat disagree. The largest file is{" "}
			<span className="text-fg">{shorten(largest.path)}</span> at{" "}
			{count(largest.loc ?? 0)} lines and {largest.commits} commits; the most
			edited is <span className="text-fg">{shorten(busiest.path)}</span> at{" "}
			{busiest.commits} commits and {count(busiest.loc ?? 0)} lines.
		</>
	);
}
