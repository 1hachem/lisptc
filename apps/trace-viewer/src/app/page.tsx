import Link from "next/link";
import {
	Masthead,
	Pill,
	ScorePill,
	Shell,
	Tag,
	Tags,
	Title,
} from "@/components/ui.tsx";
import { when } from "@/lib/format.ts";
import { listReports, reportHome } from "@/lib/reports.ts";

export const dynamic = "force-dynamic";

export default async function Home() {
	const runs = await listReports();

	return (
		<Shell>
			<Masthead>
				<Title>eval traces</Title>
				<span className="text-[11.5px] text-dim">{reportHome()}</span>
			</Masthead>

			{runs.length === 0 ? (
				<p className="border border-bg2 border-dashed p-7 text-center text-dim">
					No reports yet. Run <span className="text-fg">task evals:run</span>{" "}
					and they will appear here.
				</p>
			) : (
				<div className="grid gap-2.5">
					{runs.map((run) =>
						run.ok ? (
							<Link
								className="block border border-bg2 bg-bg1 px-4 py-3.5 transition-colors hover:border-dim/50"
								href={`/r/${encodeURIComponent(run.file)}`}
								key={run.file}
							>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<span className="text-[14px] text-fg">
										{when(run.startedAt)}
									</span>
									<ScorePill score={run.score} />
								</div>
								<Tags>
									{run.targets.map((target) => (
										<Tag key={target}>{target}</Tag>
									))}
									<Tag>
										{run.cases} run{run.cases === 1 ? "" : "s"}
									</Tag>
								</Tags>
							</Link>
						) : (
							<div
								className="border border-bg2 bg-bg1 px-4 py-3.5"
								key={run.file}
							>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<span className="text-[12px]">{run.file}</span>
									<Pill tone="red">unreadable</Pill>
								</div>
								<p className="mt-2 mb-0 text-[12px] text-dim">{run.why}</p>
							</div>
						),
					)}
				</div>
			)}
		</Shell>
	);
}
