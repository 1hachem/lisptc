import Link from "next/link";
import { when } from "@/lib/format.ts";
import { GRADES, listReports, reportDir } from "@/lib/reports.ts";

export const dynamic = "force-dynamic";

export default function Home() {
	const runs = listReports();

	return (
		<main className="shell">
			<header className="masthead">
				<h1>eval traces</h1>
				<span className="dim small mono">{reportDir()}</span>
			</header>

			{runs.length === 0 ? (
				<p className="empty">
					No reports yet. Run <span className="mono">task test:evals</span> and
					they will appear here.
				</p>
			) : (
				<div className="runs">
					{runs.map((run) =>
						run.ok ? (
							<Link
								className="run"
								href={`/r/${encodeURIComponent(run.file)}`}
								key={run.file}
							>
								<div className="run-top">
									<span className="run-when">{when(run.startedAt)}</span>
									<span className="tally">
										{GRADES.map((grade) => (
											<span
												className={`pill ${grade} ${run.tally[grade] === 0 ? "zero" : ""}`}
												key={grade}
											>
												{run.tally[grade]} {grade}
											</span>
										))}
									</span>
								</div>
								<div className="targets">
									{run.targets.map((target) => (
										<span className="tag mono" key={target}>
											{target}
										</span>
									))}
									<span className="tag">
										{run.cases} run{run.cases === 1 ? "" : "s"}
									</span>
								</div>
							</Link>
						) : (
							<div className="run" key={run.file}>
								<div className="run-top">
									<span className="run-when mono small">{run.file}</span>
									<span className="pill fail">unreadable</span>
								</div>
								<p className="dim small mono">{run.why}</p>
							</div>
						),
					)}
				</div>
			)}
		</main>
	);
}
