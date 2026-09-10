import Link from "next/link";
import { notFound } from "next/navigation";
import { duration, when } from "@/lib/format.ts";
import type { CaseInfo, ReportRow } from "@/lib/reports.ts";
import { GRADES, readReport, tallyOf } from "@/lib/reports.ts";
import { Setup } from "./setup.tsx";

export const dynamic = "force-dynamic";

function ending(row: ReportRow): string {
	return row.halted
		? `answered at step ${row.steps} · optimal ${row.min}, budget ${row.max}`
		: `never answered — ran to the ${row.steps}-step cap`;
}

function grouped(
	cases: CaseInfo[],
	rows: ReportRow[],
): [string, CaseInfo | undefined, ReportRow[]][] {
	const names = [...new Set(rows.map((row) => row.case))];
	return names.map((name) => [
		name,
		cases.find((info) => info.name === name),
		rows.filter((row) => row.case === name),
	]);
}

function Run({ row }: { row: ReportRow }) {
	const failed = row.checks.filter((check) => check.verdict === "false");

	return (
		<section className={`row ${row.grade}`}>
			<div className="row-head">
				<span className="row-title mono">
					{row.provider} · {row.model}
					{row.sample > 1 ? ` · sample ${row.sample}` : ""}
				</span>
				<span className={`pill ${row.grade}`}>{row.grade}</span>
			</div>

			<div className="row-head">
				<span className="row-meta dim small">
					<span>{ending(row)}</span>
					<span>
						{row.inputTokens} in / {row.outputTokens} out
					</span>
					<span>{duration(row.durationMs)}</span>
					<span>
						{row.errors} error{row.errors === 1 ? "" : "s"}
					</span>
					<span>
						{row.skips} skip{row.skips === 1 ? "" : "s"}
					</span>
				</span>
			</div>

			<ul className="checks">
				{row.checks.map((check) => (
					<li key={check.name}>
						<span className={`mark ${check.verdict === "true" ? "ok" : "no"}`}>
							{check.verdict === "true" ? "✓" : "✗"}
						</span>
						<span className="mono">{check.name}</span>
						{check.step !== undefined ? (
							<span className="dim small">decided at step {check.step}</span>
						) : null}
					</li>
				))}
			</ul>

			{row.recap ? (
				<div className="recap">
					<span className="who">recap</span>
					<p>
						{row.recap}
						{row.judge ? (
							<span className="dim small mono"> — {row.judge}</span>
						) : null}
					</p>
				</div>
			) : null}

			<details open={failed.length > 0 || !row.halted}>
				<summary>
					conversation — {row.transcript.length} turn
					{row.transcript.length === 1 ? "" : "s"}
				</summary>
				<div className="turns">
					{row.transcript.map((line, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: a transcript is static and repeated identical turns are the signal, not a bug
						<div className={`turn ${line.role}`} key={i}>
							<span className={`who ${line.role}`}>
								{line.role === "assistant"
									? "agent"
									: line.role === "tool"
										? "repl"
										: "user"}
							</span>
							<pre className="said">{line.content.trimEnd()}</pre>
						</div>
					))}
				</div>
			</details>
		</section>
	);
}

export default async function ReportPage({
	params,
}: {
	params: Promise<{ file: string }>;
}) {
	const { file } = await params;
	const loaded = readReport(decodeURIComponent(file));
	if (!loaded.ok) notFound();

	const { report } = loaded;
	const tally = tallyOf(report.rows);

	return (
		<main className="shell">
			<header className="masthead">
				<h1>
					<Link className="dim" href="/">
						eval traces
					</Link>{" "}
					/ {when(report.startedAt)}
				</h1>
				<span className="tally">
					{GRADES.map((grade) => (
						<span
							className={`pill ${grade} ${tally[grade] === 0 ? "zero" : ""}`}
							key={grade}
						>
							{tally[grade]} {grade}
						</span>
					))}
				</span>
			</header>

			{report.sha ? <p className="dim small mono">sha {report.sha}</p> : null}

			{grouped(report.cases, report.rows).map(([name, info, rows]) => (
				<section className="case" key={name}>
					<h2 className="case-name">{name}</h2>
					{info ? <Setup info={info} /> : null}
					{rows.map((row) => (
						<Run key={`${row.provider}-${row.model}-${row.sample}`} row={row} />
					))}
				</section>
			))}
		</main>
	);
}
