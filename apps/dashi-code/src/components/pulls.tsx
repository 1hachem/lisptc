import { Frame, Legend } from "@/components/frame.tsx";
import { Empty, Stat, Stats } from "@/components/ui.tsx";
import { Blast } from "@/components/views/blast.tsx";
import { Flow } from "@/components/views/flow.tsx";
import { Lifetimes } from "@/components/views/lifetimes.tsx";
import { Merges } from "@/components/views/merges.tsx";
import { count } from "@/lib/format.ts";
import { median } from "@/lib/plot.ts";
import type { PullRow, Pulls } from "@/lib/pulls.ts";
import type { Span } from "@/lib/span.ts";
import type { MergeTrend } from "@/lib/trend.ts";
import { mergeTrendOf } from "@/lib/trend.ts";

const LANES = 36;
const BARS = 22;

export function PullsAtlas({ span, view }: { span: Span; view: Pulls }) {
	if (view.rows.length === 0)
		return (
			<Empty>
				No pull request was open in the last{" "}
				<span className="text-fg">{span.label}</span>. Widen the span above.
			</Empty>
		);
	const open = view.rows.filter((row) => row.state === "open");
	const merged = view.rows.filter((row) => row.state === "merged");
	const days = median(
		merged
			.map((row) => row.hours)
			.filter((hours): hours is number => hours !== null)
			.map((hours) => hours / 24),
	);
	const widest = [...view.rows].sort((a, b) => b.reach - a.reach)[0];

	return (
		<>
			<Stats>
				<Stat
					label="open"
					note={`${open.filter((row) => row.draft).length} drafts`}
					tone={open.length === 0 ? "neutral" : "yellow"}
					value={count(open.length)}
				/>
				<Stat
					label="merged"
					note={`${view.rows.length - merged.length - open.length} closed unmerged`}
					value={count(merged.length)}
				/>
				<Stat
					label="median time to merge"
					note="opened to merged"
					value={`${days.toFixed(1)}d`}
				/>
				<Stat
					label="widest blast"
					note={widest === undefined ? "no pull requests" : `#${widest.number}`}
					tone={widest !== undefined && widest.reach > 0.5 ? "red" : "neutral"}
					value={
						widest === undefined ? "—" : `${(widest.reach * 100).toFixed(0)}%`
					}
				/>
			</Stats>
			<FlowFrame span={span} view={view} />
			<LifetimeFrame span={span} view={view} />
			<BlastFrame span={span} view={view} />
			<MergeFrame span={span} view={view} />
		</>
	);
}

function FlowFrame({ span, view }: { span: Span; view: Pulls }) {
	return (
		<Frame
			finding={<FlowFinding view={view} />}
			name="Pull request flow"
			spec={{
				input:
					"one row per pull request, bucketed by the week it opened or resolved",
				ceiling: "~150 weeks before the bars need binning by month",
				fails: "you read the backlog line as a rate rather than a level",
			}}
			tags={["diverging bars", "arrival × service", span.label]}
			why={
				<>
					Opened above the line, resolved below it, and underneath the number
					still open when each week ended. Arrival and service rates only mean
					something together: a week with six merges is a good week or a bad one
					depending on how many opened.
				</>
			}
		>
			<Flow flow={view.flow} />
			<Legend
				items={[
					{ color: "var(--s1)", label: "opened" },
					{ color: "var(--s2)", label: "merged" },
					{ color: "var(--muted-plot)", label: "closed unmerged" },
					{ color: "var(--crit)", label: "still open at week end", line: true },
				]}
			/>
		</Frame>
	);
}

function FlowFinding({ view }: { view: Pulls }) {
	const open = view.flow.open;
	const last = open[open.length - 1] ?? 0;
	const peak = Math.max(0, ...open);
	const opened = view.flow.opened.reduce((sum, n) => sum + n, 0);
	const resolved = view.flow.weeks.reduce(
		(sum, _, at) =>
			sum + (view.flow.merged[at] ?? 0) + (view.flow.closed[at] ?? 0),
		0,
	);
	return (
		<>
			{opened} opened and {resolved} resolved over {view.flow.weeks.length}{" "}
			weeks. The backlog peaked at {peak} and sits at {last}. A backlog that
			climbs while both bars grow is a throughput problem; one that climbs while
			the bars stay flat is a review problem.
		</>
	);
}

function LifetimeFrame({ span, view }: { span: Span; view: Pulls }) {
	const rows = view.rows.slice(0, LANES);
	return (
		<Frame
			finding={<LifetimeFinding rows={rows} />}
			name="Pull request lifetimes"
			spec={{
				input: "opened and closed timestamps, plus every commit on the branch",
				ceiling: "~40 lanes before the rows are thinner than a dot",
				fails:
					"the branch was rebased, so commit dates predate the pull request",
			}}
			tags={["gantt", "per-commit churn", span.label]}
			why={
				<>
					One lane per pull request, from the day it opened to the day it
					closed. Every commit is a dot, sized by the churn it landed, so a
					branch that grew quietly for a week and then doubled overnight reads
					differently from one that arrived whole.
				</>
			}
		>
			<Lifetimes asOf={view.generated} rows={rows} />
			<Legend
				items={[
					{ color: "var(--crit)", label: "open" },
					{ color: "var(--s1)", label: "merged" },
					{ color: "var(--muted-plot)", label: "closed unmerged" },
				]}
			/>
		</Frame>
	);
}

function LifetimeFinding({ rows }: { rows: PullRow[] }) {
	const longest = [...rows]
		.filter((row) => row.hours !== null)
		.sort((a, b) => (b.hours ?? 0) - (a.hours ?? 0))[0];
	const fattest = [...rows].sort(
		(a, b) => b.added + b.deleted - (a.added + a.deleted),
	)[0];
	if (longest === undefined || fattest === undefined) return null;
	return (
		<>
			<span className="text-fg">#{longest.number}</span> was open longest at{" "}
			{((longest.hours ?? 0) / 24).toFixed(1)} days over{" "}
			{longest.commits.length} commits.{" "}
			<span className="text-fg">#{fattest.number}</span> is the heaviest, +
			{count(fattest.added)} −{count(fattest.deleted)} across {fattest.changed}{" "}
			files.
		</>
	);
}

function BlastFrame({ span, view }: { span: Span; view: Pulls }) {
	const rows = [...view.rows]
		.sort((a, b) => b.reach - a.reach || b.blastFiles - a.blastFiles)
		.slice(0, BARS);
	return (
		<Frame
			finding={<BlastFinding rows={rows} view={view} />}
			name="Blast radius"
			spec={{
				input:
					"changed files mapped to workspaces, closed over the dependency graph",
				ceiling: "~25 bars; past that rank and page",
				fails:
					"a change stays inside a file nothing imports, and the bar overstates it",
			}}
			tags={["ranked bars", "reverse dependency closure", span.label]}
			why={
				<>
					What a pull request edits is the small part. The bar adds every
					workspace that transitively depends on one it touched, because those
					are the ones a mistake reaches. A feature confined to a leaf package
					and a feature in the interpreter can be the same diff and not the same
					risk.
				</>
			}
		>
			<Blast rows={rows} workspaces={view.workspaces} />
			<Legend
				items={[
					{ color: "var(--q600)", label: "edited" },
					{ color: "var(--q200)", label: "downstream of an edit" },
				]}
			/>
		</Frame>
	);
}

function BlastFinding({ rows, view }: { rows: PullRow[]; view: Pulls }) {
	const widest = rows[0];
	if (widest === undefined) return null;
	return (
		<>
			<span className="text-fg">#{widest.number}</span> reaches{" "}
			{widest.touched.length + widest.downstream.length} of {view.workspaces}{" "}
			workspaces from {widest.touched.length} it edits, putting{" "}
			{count(widest.blastFiles)} source files in range. Median reach across the
			window is {(median(view.rows.map((row) => row.reach)) * 100).toFixed(0)}%.
		</>
	);
}

function MergeFrame({ span, view }: { span: Span; view: Pulls }) {
	const trend = mergeTrendOf(view.rows);
	return (
		<Frame
			finding={<MergeFinding trend={trend} />}
			name="Time to merge and blast radius"
			spec={{
				input: "merged pull requests, bucketed by the week they merged",
				ceiling:
					"~150 weeks before the dots collide and the lines need binning",
				fails:
					"a week merged one pull request, so its median is that single number",
			}}
			tags={["paired series", "median × mean", span.label]}
			why={
				<>
					How long a pull request waits, and how far it reaches once it lands,
					read against the same weeks. The median resists the one branch that
					sat for a month; the dot above it carries how many merged, because a
					median of two is not a rate. Both climbing together is the shape to
					catch: branches growing wider and living longer feed each other.
				</>
			}
		>
			<Merges trend={trend} />
			<Legend
				items={[
					{ color: "var(--s1)", label: "median days to merge", line: true },
					{
						color: "var(--crit)",
						label: "average blast radius",
						line: true,
					},
				]}
			/>
		</Frame>
	);
}

function MergeFinding({ trend }: { trend: MergeTrend }) {
	const days = trend.days.filter((value): value is number => value !== null);
	const reach = trend.reach.filter((value): value is number => value !== null);
	if (days.length === 0) return null;
	if (days.length < 4)
		return (
			<>
				Only {days.length} {days.length === 1 ? "week" : "weeks"} merged
				anything, too few to call a direction. The median sits at{" "}
				{median(days).toFixed(1)} days and the average pull request reaches{" "}
				{(median(reach) * 100).toFixed(0)}% of the workspaces.
			</>
		);
	const half = Math.floor(days.length / 2);
	const early = median(days.slice(0, half));
	const late = median(days.slice(half));
	const earlyReach = median(reach.slice(0, half)) * 100;
	const lateReach = median(reach.slice(half)) * 100;
	return (
		<>
			Merging takes <span className="text-fg">{late.toFixed(1)} days</span>{" "}
			across the recent half of the window against {early.toFixed(1)} across the
			earlier half, and the average pull request reaches {lateReach.toFixed(0)}%
			of the workspaces against {earlyReach.toFixed(0)}%. Slower and wider
			together means scope is creeping into the branch; slower and narrower is
			review sitting in the queue.
		</>
	);
}
