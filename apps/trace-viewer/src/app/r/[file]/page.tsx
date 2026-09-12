import Link from "next/link";
import { notFound } from "next/navigation";
import {
	Masthead,
	Panel,
	ScorePill,
	Shell,
	Summary,
	Title,
	Turn,
} from "@/components/ui.tsx";
import { duration, when } from "@/lib/format.ts";
import type { CaseInfo, ReportRow } from "@/lib/reports.ts";
import { readReport, scoreOf } from "@/lib/reports.ts";
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
	const score = scoreOf([row]);

	return (
		<Panel className={`mb-3.5 ${score.tone === "red" ? "border-red/35" : ""}`}>
			<div className="flex flex-wrap items-center justify-between gap-3 border-bg2 border-b bg-bg2/40 px-4 py-3">
				<span className="text-fg">
					{row.provider} · {row.model}
					{row.sample > 1 ? ` · sample ${row.sample}` : ""}
				</span>
				<ScorePill score={score} />
			</div>

			<div className="flex flex-wrap gap-3.5 border-bg2 border-b px-4 py-2.5 text-[12px] text-dim">
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
			</div>

			<ul className="m-0 grid list-none gap-1.5 border-bg2 border-b px-4 py-3">
				{row.checks.map((check) => (
					<li className="flex items-baseline gap-2.5" key={check.name}>
						<span
							className={check.verdict === "true" ? "text-green" : "text-red"}
						>
							{check.verdict === "true" ? "✓" : "✗"}
						</span>
						<span>{check.name}</span>
						{check.step !== undefined ? (
							<span className="text-[12px] text-dim">
								decided at step {check.step}
							</span>
						) : null}
					</li>
				))}
			</ul>

			{row.recap ? (
				<div className="grid grid-cols-[54px_1fr] gap-3 border-bg2 border-b bg-blue/5 px-4 py-3">
					<span className="text-[11px] text-dim uppercase tracking-[0.14em]">
						recap
					</span>
					<p className="m-0">
						{row.recap}
						{row.judge ? (
							<span className="text-[12px] text-dim"> — {row.judge}</span>
						) : null}
					</p>
				</div>
			) : null}

			<details open={failed.length > 0 || !row.halted}>
				<Summary>
					conversation — {row.transcript.length} turn
					{row.transcript.length === 1 ? "" : "s"}
				</Summary>
				<div className="pt-1 pb-2.5">
					{row.transcript.map((line, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: a transcript is static and repeated identical turns are the signal, not a bug
						<Turn key={i} role={line.role}>
							{line.content.trimEnd()}
						</Turn>
					))}
				</div>
			</details>
		</Panel>
	);
}

export default async function ReportPage({
	params,
}: {
	params: Promise<{ file: string }>;
}) {
	const { file } = await params;
	const loaded = await readReport(decodeURIComponent(file));
	if (!loaded.ok) notFound();

	const { report } = loaded;
	const score = scoreOf(report.rows);

	return (
		<Shell>
			<Masthead>
				<Title>
					<Link className="text-dim hover:text-fg" href="/">
						eval traces
					</Link>{" "}
					/ {when(report.startedAt)}
				</Title>
				<ScorePill score={score} />
			</Masthead>

			{report.sha ? (
				<p className="mt-0 mb-4 text-[12px] text-dim">sha {report.sha}</p>
			) : null}

			{grouped(report.cases, report.rows).map(([name, info, rows]) => (
				<section className="mb-7" key={name}>
					<h2 className="m-0 mb-2 text-[14px] text-aqua">{name}</h2>
					{info ? <Setup info={info} /> : null}
					{rows.map((row) => (
						<Run key={`${row.provider}-${row.model}-${row.sample}`} row={row} />
					))}
				</section>
			))}
		</Shell>
	);
}
