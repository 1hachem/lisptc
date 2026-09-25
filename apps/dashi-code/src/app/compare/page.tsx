import Link from "next/link";
import { Fragment } from "react";
import { atlasPanels } from "@/components/atlas.tsx";
import { Empty, Masthead, Pill, Shell, Title } from "@/components/ui.tsx";
import { count, when } from "@/lib/format.ts";
import type { Snapshot } from "@/lib/snapshot.ts";
import { snapshot } from "@/lib/snapshot.ts";
import { readVersion } from "@/lib/versions.ts";

export const dynamic = "force-dynamic";

interface Side {
	label: string;
	head: string;
	takenAt: number;
	view: Snapshot;
}

async function sideOf(key: string | undefined): Promise<Side | null> {
	if (key === undefined || key === "live") {
		const view = await snapshot();
		return {
			label: "live",
			head: view.head.slice(0, 7),
			takenAt: view.generated,
			view,
		};
	}
	const view = await readVersion(key);
	return view === null
		? null
		: {
				label: key,
				head: view.head.slice(0, 7),
				takenAt: view.generated,
				view,
			};
}

export default async function Compare({
	searchParams,
}: {
	searchParams: Promise<{ a?: string; b?: string }>;
}) {
	const { a, b } = await searchParams;
	const [left, right] = await Promise.all([sideOf(a), sideOf(b)]);

	if (left === null || right === null)
		return (
			<Shell>
				<Masthead>
					<Title>compare</Title>
					<Link className="text-[12px] text-dim hover:text-fg" href="/versions">
						versions
					</Link>
				</Masthead>
				<Empty>
					One of those versions could not be read. Pick two from the versions
					list.
				</Empty>
			</Shell>
		);

	const leftPanels = atlasPanels(left.view, true);
	const rightPanels = atlasPanels(right.view, true);

	return (
		<Shell wide>
			<Masthead>
				<Title>compare</Title>
				<Link className="text-[12px] text-dim hover:text-fg" href="/versions">
					versions
				</Link>
			</Masthead>

			<Deltas left={left} right={right} />

			<div className="grid min-w-0 gap-2.5 lg:grid-cols-2">
				<ColumnHead side={left} />
				<ColumnHead side={right} />
				{leftPanels.map((panel, index) => (
					<Fragment key={panel.key}>
						<div className="grid min-w-0">{panel.node}</div>
						<div className="grid min-w-0">
							{rightPanels[index]?.node ?? null}
						</div>
					</Fragment>
				))}
			</div>
		</Shell>
	);
}

function ColumnHead({ side }: { side: Side }) {
	return (
		<header className="flex flex-wrap items-baseline justify-between gap-2 border-bg2 border-b pb-2">
			<span className="text-[13px] text-fg">{when(side.takenAt)}</span>
			<Pill>{side.head}</Pill>
		</header>
	);
}

function Deltas({ left, right }: { left: Side; right: Side }) {
	const rows = [
		{
			label: "commits",
			from: left.view.commits,
			to: right.view.commits,
		},
		{
			label: "source files",
			from: sourceCount(left.view),
			to: sourceCount(right.view),
		},
		{
			label: "lines",
			from: lineCount(left.view),
			to: lineCount(right.view),
		},
		{
			label: "import cycles",
			from: left.view.cycles.length,
			to: right.view.cycles.length,
		},
		{
			label: "dep edges",
			from: left.view.edges.length,
			to: right.view.edges.length,
		},
	];

	return (
		<div className="grid gap-px bg-bg2 sm:grid-cols-5">
			{rows.map((row) => {
				const delta = row.to - row.from;
				const tone =
					delta === 0
						? "var(--dim-plot)"
						: (row.label === "import cycles") === delta > 0
							? "var(--crit)"
							: "var(--good)";
				return (
					<div className="bg-bg1 px-4 py-3" key={row.label}>
						<div className="text-[10.5px] text-dim uppercase tracking-wider">
							{row.label}
						</div>
						<div className="mt-1 text-[18px] text-fg tabular-nums">
							{count(row.to)}
						</div>
						<div className="text-[11.5px] tabular-nums" style={{ color: tone }}>
							{delta === 0
								? "unchanged"
								: `${delta > 0 ? "+" : ""}${count(delta)} from ${count(row.from)}`}
						</div>
					</div>
				);
			})}
		</div>
	);
}

function sourceCount(view: Snapshot): number {
	return view.files.filter((file) => file.tracked && !file.isTest).length;
}

function lineCount(view: Snapshot): number {
	return view.files
		.filter((file) => file.tracked && !file.isTest)
		.reduce((sum, file) => sum + (file.loc ?? 0), 0);
}
