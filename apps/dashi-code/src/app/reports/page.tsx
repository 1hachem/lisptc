import Link from "next/link";
import { Forget } from "@/components/forget.tsx";
import { Empty, Masthead, Pill, Shell, Title } from "@/components/ui.tsx";
import { count, percent, when } from "@/lib/format.ts";
import { listReports, storeHome } from "@/lib/reports.ts";

export const dynamic = "force-dynamic";

export default async function Reports() {
	const runs = await listReports();

	return (
		<Shell>
			<Masthead>
				<Title>runtime reports</Title>
				<div className="flex items-center gap-3">
					<span className="text-[11.5px] text-dim">{storeHome()}</span>
					<Link className="text-[12px] text-dim hover:text-fg" href="/">
						views
					</Link>
				</div>
			</Masthead>

			{runs.length === 0 ? (
				<Empty>
					No reports yet. Write one with{" "}
					<span className="text-fg">task dashi-codes:capture</span>.
				</Empty>
			) : (
				<div className="grid gap-2.5">
					{runs.map((run) =>
						run.ok ? (
							<div
								className="border border-bg2 bg-bg1 px-4 py-3.5"
								key={run.file}
							>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<Link
										className="text-[14px] text-fg transition-colors hover:text-blue"
										href={`/r/${encodeURIComponent(run.file)}`}
									>
										{when(run.storedAt)}
									</Link>
									<div className="flex items-center gap-2 text-[12px]">
										<Pill>{run.dataSource}</Pill>
										<Pill tone={run.deletable === 0 ? "neutral" : "red"}>
											{count(run.deletable ?? 0)} to delete
										</Pill>
										<Forget
											file={run.file}
											kind="report"
											taken={when(run.storedAt)}
										/>
									</div>
								</div>
								<div className="mt-2 flex flex-wrap gap-4 text-[12px] text-dim tabular-nums">
									<span>{count(run.traceCount ?? 0)} traces</span>
									<span>{count(run.tracked ?? 0)} tracked</span>
									<span>{count(run.hit ?? 0)} hit</span>
									<span>{count(run.untracked ?? 0)} untracked</span>
									<span>{percent(run.coveragePercent ?? 0)} covered</span>
								</div>
							</div>
						) : (
							<div
								className="border border-bg2 bg-bg1 px-4 py-3.5"
								key={run.file}
							>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<span className="text-[12px]">{run.file}</span>
									<div className="flex items-center gap-2 text-[12px]">
										<Pill tone="red">unreadable</Pill>
										<Forget
											file={run.file}
											kind="report"
											taken={when(run.storedAt)}
										/>
									</div>
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
