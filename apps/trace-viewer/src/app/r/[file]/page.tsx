import type { RunIdentity } from "@repo/evals/review";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Transcript } from "@/components/transcript.tsx";
import {
	Chip,
	ChipRow,
	Masthead,
	Panel,
	ScorePill,
	Shell,
	Summary,
	Title,
} from "@/components/ui.tsx";
import { duration, when } from "@/lib/format.ts";
import type { CaseInfo, ReportRow } from "@/lib/reports.ts";
import { readReport, scoreOf, targetOf } from "@/lib/reports.ts";
import type { ReviewTarget } from "@/lib/reviews.ts";
import { reviewTarget } from "@/lib/reviews.ts";
import { Setup } from "./setup.tsx";

export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

function toggled(
	file: string,
	query: Query,
	key: string,
	value: string,
): string {
	const next = new URLSearchParams();
	for (const [name, held] of Object.entries(query)) {
		const single = one(held);
		if (single && name !== key) next.set(name, single);
	}
	if (one(query[key]) !== value) next.set(key, value);
	const search = next.toString();
	return `/r/${encodeURIComponent(file)}${search ? `?${search}` : ""}`;
}

function Filters({
	file,
	query,
	rows,
	shown,
}: {
	file: string;
	query: Query;
	rows: ReportRow[];
	shown: number;
}) {
	const evals = [...new Set(rows.map((row) => row.case))];
	const models = [...new Set(rows.map(targetOf))];
	if (evals.length < 2 && models.length < 2) return null;

	const chosenEval = one(query.eval);
	const chosenModel = one(query.model);

	return (
		<div className="mb-5 grid gap-2 border border-bg2 bg-bg1 px-4 py-3">
			{evals.length > 1 ? (
				<ChipRow label="eval">
					{evals.map((name) => (
						<Chip
							active={chosenEval === name}
							href={toggled(file, query, "eval", name)}
							key={name}
						>
							{name}
						</Chip>
					))}
				</ChipRow>
			) : null}

			{models.length > 1 ? (
				<ChipRow label="model">
					{models.map((target) => (
						<Chip
							active={chosenModel === target}
							href={toggled(file, query, "model", target)}
							key={target}
						>
							{target}
						</Chip>
					))}
				</ChipRow>
			) : null}

			{chosenEval || chosenModel ? (
				<p className="m-0 text-[12px] text-dim">
					showing {shown} of {rows.length} runs ·{" "}
					<Link
						className="text-dim underline hover:text-fg"
						href={`/r/${encodeURIComponent(file)}`}
					>
						clear
					</Link>
				</p>
			) : null}
		</div>
	);
}

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

function Run({
	identity,
	row,
	target,
}: {
	identity: RunIdentity;
	row: ReportRow;
	target?: ReviewTarget;
}) {
	const failed = row.checks.filter((check) => check.verdict === "false");
	const score = scoreOf([row]);

	return (
		<Panel className={`mb-3.5 ${score.tone === "red" ? "border-red/35" : ""}`}>
			<div className="flex flex-wrap items-center justify-between gap-3 border-bg2 border-b bg-bg2/40 px-4 py-3">
				<span className="text-fg">
					{targetOf(row)}
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
				<Transcript identity={identity} row={row} target={target} />
			</details>
		</Panel>
	);
}

export default async function ReportPage({
	params,
	searchParams,
}: {
	params: Promise<{ file: string }>;
	searchParams: Promise<Query>;
}) {
	const { file } = await params;
	const name = decodeURIComponent(file);
	const query = await searchParams;
	const loaded = await readReport(name);
	if (!loaded.ok) notFound();

	const { report } = loaded;
	const chosenEval = one(query.eval);
	const chosenModel = one(query.model);
	const rows = report.rows.filter(
		(row) =>
			(chosenEval === undefined || row.case === chosenEval) &&
			(chosenModel === undefined || targetOf(row) === chosenModel),
	);
	const score = scoreOf(rows);
	const identity: RunIdentity = {
		file: name,
		startedAt: report.startedAt,
		sha: report.sha,
	};
	const target = reviewTarget();

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

			<Filters
				file={name}
				query={query}
				rows={report.rows}
				shown={rows.length}
			/>

			{rows.length === 0 ? (
				<p className="border border-bg2 border-dashed p-7 text-center text-dim">
					No runs match this filter.
				</p>
			) : null}

			{grouped(report.cases, rows).map(([caseName, info, runs]) => (
				<section className="mb-7" key={caseName}>
					<h2 className="m-0 mb-2 text-[14px] text-aqua">{caseName}</h2>
					{info ? <Setup info={info} /> : null}
					{runs.map((row) => (
						<Run
							identity={identity}
							key={`${row.provider}-${row.model}-${row.sample}`}
							row={row}
							target={target}
						/>
					))}
				</section>
			))}
		</Shell>
	);
}
