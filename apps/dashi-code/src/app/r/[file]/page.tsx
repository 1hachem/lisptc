import Link from "next/link";
import { PartToWhole, Ranked } from "@/components/bars.tsx";
import { ComplexityScatter } from "@/components/complexity.tsx";
import {
	Empty,
	Masthead,
	Panel,
	Pill,
	Shell,
	Stat,
	Stats,
	Title,
	type Tone,
} from "@/components/ui.tsx";
import { count, percent, short, where } from "@/lib/format.ts";
import type { Verdict } from "@/lib/report.ts";
import { healthOf } from "@/lib/report.ts";
import { countVerdicts, readReport } from "@/lib/reports.ts";

export const dynamic = "force-dynamic";

const verdictTone: Record<Verdict, Tone> = {
	safe_to_delete: "red",
	review_required: "yellow",
	low_traffic: "blue",
	coverage_unavailable: "neutral",
	active: "green",
};

const riskTone: Record<string, Tone> = {
	high: "red",
	medium: "yellow",
	low: "neutral",
};

const SHOWN_FINDINGS = 120;
const SHOWN_BLAST = 12;
const SHOWN_HOTSPOTS = 10;

export default async function Run({
	params,
}: {
	params: Promise<{ file: string }>;
}) {
	const { file } = await params;
	const loaded = await readReport(decodeURIComponent(file));

	if (!loaded.ok)
		return (
			<Shell>
				<Masthead>
					<Title>{decodeURIComponent(file)}</Title>
					<Link className="text-[12px] text-dim hover:text-fg" href="/">
						back
					</Link>
				</Masthead>
				<Empty>{loaded.why}</Empty>
			</Shell>
		);

	const { report } = loaded;
	const health = healthOf(report);
	const runtime = report.runtime_coverage;

	if (runtime === null || runtime === undefined)
		return (
			<Shell>
				<Masthead>
					<Title>{decodeURIComponent(file)}</Title>
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						{health === null ? null : (
							<Pill>
								{health.grade === null
									? health.score.toFixed(1)
									: `${health.grade} · ${health.score.toFixed(1)}`}
							</Pill>
						)}
						<Pill>static only</Pill>
						<Link className="text-[12px] text-dim hover:text-fg" href="/">
							back
						</Link>
					</div>
				</Masthead>
				<p className="m-0 border border-bg2 bg-bg1 px-4 py-2.5 text-[12px] text-dim">
					No runtime coverage in this report, so it carries complexity and
					hotspots only. Flush a capture with{" "}
					<span className="text-fg">task dashi-codes:capture:docker</span> and
					refresh to get the runtime half.
				</p>
				<Panel note="cyclomatic against CRAP" title="complexity">
					<ComplexityScatter findings={report.findings} />
				</Panel>
			</Shell>
		);

	const { summary } = runtime;
	const quality = summary.capture_quality;
	const verdicts = countVerdicts(report);
	const actionable = runtime.findings.filter(
		(finding) =>
			finding.verdict === "safe_to_delete" ||
			finding.verdict === "review_required",
	);

	return (
		<Shell>
			<Masthead>
				<Title>{decodeURIComponent(file)}</Title>
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					{health === null ? null : (
						<Pill>
							{health.grade === null
								? health.score.toFixed(1)
								: `${health.grade} · ${health.score.toFixed(1)}`}
						</Pill>
					)}
					<Pill>{summary.data_source}</Pill>
					{runtime.verdict === null || runtime.verdict === undefined ? null : (
						<Pill tone={runtime.actionable === true ? "yellow" : "neutral"}>
							{runtime.verdict}
						</Pill>
					)}
					<Link className="text-[12px] text-dim hover:text-fg" href="/">
						back
					</Link>
				</div>
			</Masthead>

			{quality?.lazy_parse_warning === true ? (
				<p className="m-0 border border-yellow/40 bg-bg1 px-4 py-2.5 text-[12px] text-dim">
					<span className="text-yellow">lazy parse</span> — V8 never parsed{" "}
					{percent(quality.untracked_ratio_percent ?? 0)} of the functions in
					this capture, so an untracked function is unobserved rather than
					unused.
				</p>
			) : null}

			<Stats>
				<Stat label="traces" value={short(summary.trace_count)} />
				<Stat
					label="tracked"
					note={`${count(summary.functions_untracked)} untracked`}
					value={count(summary.functions_tracked)}
				/>
				<Stat
					label="hit"
					note={percent(summary.coverage_percent)}
					tone={summary.functions_hit === 0 ? "neutral" : "green"}
					value={count(summary.functions_hit)}
				/>
				<Stat
					label="safe to delete"
					tone={
						verdicts.find((row) => row.verdict === "safe_to_delete")?.count ===
						0
							? "neutral"
							: "red"
					}
					value={count(
						verdicts.find((row) => row.verdict === "safe_to_delete")?.count ??
							0,
					)}
				/>
			</Stats>

			<Panel note="of the functions V8 could track" title="coverage">
				<PartToWhole
					slices={[
						{ label: "hit", value: summary.functions_hit, tone: "blue" },
						{
							label: "never hit",
							value: summary.functions_unhit,
							tone: "blue",
							opacity: 0.5,
						},
						{
							label: "untracked",
							value: summary.functions_untracked,
							tone: "neutral",
							opacity: 0.4,
						},
					]}
				/>
			</Panel>

			<Panel title="verdicts">
				<Ranked
					rows={verdicts.map((row) => ({
						label: row.verdict.replaceAll("_", " "),
						value: row.count,
						tone: verdictTone[row.verdict],
					}))}
				/>
			</Panel>

			{runtime.blast_radius.length === 0 ? null : (
				<Panel note="callers reaching the function" title="blast radius">
					<Ranked
						rows={[...runtime.blast_radius]
							.sort((a, b) => (b.caller_count ?? 0) - (a.caller_count ?? 0))
							.slice(0, SHOWN_BLAST)
							.map((entry) => ({
								label: `${entry.function} · ${where(entry.file, entry.line)}`,
								note: entry.risk_band,
								value: entry.caller_count ?? 0,
								tone: riskTone[entry.risk_band] ?? "neutral",
							}))}
					/>
				</Panel>
			)}

			{report.hotspots.length === 0 ? null : (
				<Panel note="change against complexity" title="hotspots">
					<Ranked
						rows={[...report.hotspots]
							.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
							.slice(0, SHOWN_HOTSPOTS)
							.map((spot) => ({
								label: spot.path,
								note: `${count(spot.commits ?? 0)} commits · ${spot.trend ?? "steady"}`,
								value: Math.round(spot.score ?? 0),
								tone: spot.trend === "accelerating" ? "red" : "neutral",
							}))}
					/>
				</Panel>
			)}

			<Panel note="cyclomatic against CRAP" title="complexity">
				<ComplexityScatter findings={report.findings} />
			</Panel>

			<Panel
				note={`${count(actionable.length)} of ${count(runtime.findings.length)}`}
				title="what to act on"
			>
				{actionable.length === 0 ? (
					<p className="m-0 text-dim">nothing actionable in this capture</p>
				) : (
					<div className="grid gap-px bg-bg2">
						{actionable.slice(0, SHOWN_FINDINGS).map((finding) => (
							<div
								className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-bg1 px-3 py-2"
								key={finding.id}
							>
								<span className="shrink-0 text-[12.5px] text-fg">
									{finding.function}
								</span>
								<span className="min-w-0 grow truncate text-[11.5px] text-dim">
									{where(finding.path, finding.line)}
								</span>
								<span className="flex items-center gap-2 text-[11px] text-dim">
									{finding.evidence?.untracked_reason === null ||
									finding.evidence?.untracked_reason === undefined ? null : (
										<span>{finding.evidence.untracked_reason}</span>
									)}
									{finding.confidence === null ||
									finding.confidence === undefined ? null : (
										<span>{finding.confidence}</span>
									)}
									<Pill tone={verdictTone[finding.verdict]}>
										{finding.verdict.replaceAll("_", " ")}
									</Pill>
								</span>
							</div>
						))}
					</div>
				)}
			</Panel>
		</Shell>
	);
}
