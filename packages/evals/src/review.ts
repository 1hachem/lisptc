import type { ReportRow, TranscriptLine } from "./report.ts";

export const TRACE_BUDGET = 100_000;

export interface RunIdentity {
	file: string;
	startedAt: string;
	sha: string;
}

export interface FittedTrace {
	lines: TranscriptLine[];
	from: number;
	dropped: number;
}

export function runId(identity: RunIdentity, row: ReportRow): string {
	return `${identity.file}#${row.case}/${row.provider}/${row.model}/${row.sample}`;
}

function weigh(line: TranscriptLine): number {
	return JSON.stringify(line).length + 1;
}

function clamp(line: TranscriptLine, budget: number): TranscriptLine {
	if (weigh(line) <= budget) return line;
	const room = Math.max(0, budget - weigh({ ...line, content: "" }));
	return { ...line, content: `${line.content.slice(0, room)}…` };
}

export function fitTrace(
	transcript: TranscriptLine[],
	index: number,
	budget = TRACE_BUDGET,
): FittedTrace {
	if (transcript.length === 0) return { lines: [], from: 0, dropped: 0 };
	const at = Math.min(Math.max(index, 0), transcript.length - 1);
	const anchor = clamp(transcript[at], budget);
	let left = at;
	let right = at;
	let spent = weigh(anchor);

	while (left > 0 || right < transcript.length - 1) {
		const before = left > 0 ? weigh(transcript[left - 1]) : undefined;
		const after =
			right < transcript.length - 1 ? weigh(transcript[right + 1]) : undefined;
		const takeBefore =
			before !== undefined &&
			spent + before <= budget &&
			(after === undefined || before <= after);
		const takeAfter = after !== undefined && spent + after <= budget;
		if (takeBefore) {
			left -= 1;
			spent += before;
		} else if (takeAfter) {
			right += 1;
			spent += after;
		} else break;
	}

	const lines = transcript
		.slice(left, right + 1)
		.map((line, i) => (left + i === at ? anchor : line));
	return {
		lines,
		from: left,
		dropped: transcript.length - lines.length,
	};
}

export function reviewProperties(
	identity: RunIdentity,
	row: ReportRow,
	index: number,
	budget = TRACE_BUDGET,
): Record<string, unknown> {
	const fitted = fitTrace(row.transcript, index, budget);
	const failed = row.checks.filter((check) => check.verdict !== "true");
	return {
		eval_run: runId(identity, row),
		eval_report: identity.file,
		eval_started_at: identity.startedAt,
		eval_sha: identity.sha,
		eval_case: row.case,
		eval_provider: row.provider,
		eval_model: row.model,
		eval_sample: row.sample,
		eval_grade: row.grade,
		eval_steps: row.steps,
		eval_halted: row.halted,
		eval_checks_passed: row.checks.length - failed.length,
		eval_checks_total: row.checks.length,
		eval_checks_failed: failed.map((check) => check.name),
		message_index: index,
		message_role: row.transcript[index]?.role,
		trace: fitted.lines,
		trace_from: fitted.from,
		trace_dropped: fitted.dropped,
		trace_turns: row.transcript.length,
	};
}
