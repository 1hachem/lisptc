import { Frame, Legend } from "@/components/frame.tsx";
import { CrapTrend } from "@/components/views/crap-trend.tsx";
import { CRAPPY, type Crap, type CrapSummary } from "@/lib/crap.ts";
import { count, shorten, when } from "@/lib/format.ts";

export function CrapFrame({
	compact,
	crap,
}: {
	compact: boolean;
	crap: Crap | null;
}) {
	return (
		<Frame
			compact={compact}
			finding={crap === null ? null : <CrapFinding crap={crap} />}
			name="CRAP over time"
			spec={{
				input:
					"fallow health over every function, coverage estimated from test reachability",
				ceiling: "a point per analysis; a line, so hundreds before it blurs",
				fails:
					"the estimate counts a function as covered when a test can reach it, not when one runs it",
			}}
			tags={["line", "AST × tests"]}
			why={
				<>
					Change Risk Anti-Patterns: cyclomatic² × (1 − coverage)³ + cyclomatic,
					per function. Complexity alone is tolerable when tests hold it; CRAP
					rises when a function is both branchy and untested. A score of{" "}
					{CRAPPY} or more is the classic line where a change is a gamble.
				</>
			}
		>
			{crap === null ? (
				<p className="m-0 text-dim">
					no CRAP measured yet: refresh to run the first analysis
				</p>
			) : (
				<>
					<CrapTrend history={crap.history} />
					<Legend
						items={[
							{
								color: "var(--crit)",
								label: `functions at ${CRAPPY}+`,
								line: true,
							},
							{ color: "var(--s1)", label: "mean CRAP", line: true },
						]}
					/>
					<Worst crap={crap} />
				</>
			)}
		</Frame>
	);
}

function Worst({ crap }: { crap: Crap }) {
	return (
		<table className="mt-3 w-full border-collapse text-[12.5px] tabular-nums">
			<thead>
				<tr className="text-left text-[10.5px] text-dim uppercase tracking-wider">
					<th className="py-1 pr-3 font-normal">function</th>
					<th className="py-1 pr-3 text-right font-normal">crap</th>
					<th className="py-1 pr-3 text-right font-normal">cyclomatic</th>
					<th className="py-1 text-right font-normal">coverage</th>
				</tr>
			</thead>
			<tbody>
				{crap.latest.worst.map((row) => (
					<tr
						className="border-bg2 border-t"
						key={`${row.file}:${row.line}:${row.col}:${row.name}`}
					>
						<td className="py-1 pr-3">
							<span className="text-fg">{row.name}</span>{" "}
							<span className="text-dim">
								{shorten(row.file)}:{row.line}
							</span>
						</td>
						<td className="py-1 pr-3 text-right text-fg">
							{row.crap.toFixed(1)}
						</td>
						<td className="py-1 pr-3 text-right text-dim">
							{row.cyclomatic ?? "-"}
						</td>
						<td className="py-1 text-right text-dim">
							{row.coverage === null ? "-" : `${row.coverage.toFixed(0)}%`}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function CrapFinding({ crap }: { crap: Crap }) {
	const { latest, history } = crap;
	const before = history.length > 1 ? history[0] : undefined;
	const worst = latest.worst[0];
	return (
		<>
			{count(latest.crappy)} of {count(latest.functions)} functions score{" "}
			{CRAPPY} or more
			{before === undefined ? "" : <Since before={before} now={latest} />}.
			{worst === undefined ? null : (
				<>
					{" "}
					The worst is <span className="text-fg">{worst.name}</span> in{" "}
					{shorten(worst.file)} at {worst.crap.toFixed(1)}.
				</>
			)}
		</>
	);
}

function Since({ before, now }: { before: CrapSummary; now: CrapSummary }) {
	const delta = now.crappy - before.crappy;
	const change =
		delta === 0
			? "unchanged"
			: `${delta > 0 ? "up" : "down"} ${count(Math.abs(delta))}`;
	return (
		<>
			, {change} since {when(before.generated)}
		</>
	);
}
