import type { ReportRow, TranscriptLine } from "./report.ts";

export const TRACE_BUDGET = 100_000;
export const MESSAGE_BUDGET = 10_000;

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

export interface TraceEvent {
	event: string;
	properties: Record<string, unknown>;
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

function identityOf(
	identity: RunIdentity,
	row: ReportRow,
): Record<string, unknown> {
	return {
		eval_run: runId(identity, row),
		eval_report: identity.file,
		eval_started_at: identity.startedAt,
		eval_sha: identity.sha,
		eval_case: row.case,
		eval_provider: row.provider,
		eval_model: row.model,
		eval_sample: row.sample,
	};
}

export function traceEvents(
	identity: RunIdentity,
	row: ReportRow,
	budget = TRACE_BUDGET,
): TraceEvent[] {
	const trace = runId(identity, row);
	const root = `${trace}/run`;
	const failed = row.checks.filter((check) => check.verdict !== "true");
	const shared = {
		$ai_trace_id: trace,
		$ai_provider: row.provider,
		$ai_model: row.model,
		...identityOf(identity, row),
	};

	const events: TraceEvent[] = [
		{
			event: "$ai_trace",
			properties: {
				...shared,
				$ai_span_id: root,
				$ai_span_name: `eval ${row.case}`,
				$ai_latency: row.durationMs / 1000,
				$ai_is_error: !row.halted,
				$ai_input_state:
					row.transcript.find((line) => line.role === "user")?.content ?? "",
				$ai_output_state: row.answer,
				$ai_input_tokens: row.inputTokens,
				$ai_output_tokens: row.outputTokens,
				eval_grade: row.grade,
				eval_steps: row.steps,
				eval_halted: row.halted,
				eval_checks_passed: row.checks.length - failed.length,
				eval_checks_total: row.checks.length,
				eval_checks_failed: failed.map((check) => check.name),
			},
		},
	];

	let step = 0;
	row.transcript.forEach((line, i) => {
		if (line.role === "assistant") {
			step += 1;
			events.push({
				event: "$ai_generation",
				properties: {
					...shared,
					$ai_span_id: `${trace}/${i}`,
					$ai_parent_id: root,
					$ai_span_name: `step ${step}`,
					$ai_input: fitTrace(row.transcript.slice(0, i), i - 1, budget).lines,
					$ai_output_choices: [{ role: "assistant", content: line.content }],
					step,
				},
			});
		}
		if (line.role === "tool") {
			events.push({
				event: "$ai_span",
				properties: {
					...shared,
					$ai_span_id: `${trace}/${i}`,
					$ai_parent_id: root,
					$ai_span_name: `repl eval ${step}`,
					$ai_input_state: row.transcript[i - 1]?.content ?? "",
					$ai_output_state: clamp(line, budget).content,
					step,
				},
			});
		}
	});

	return events;
}

export function reviewProperties(
	identity: RunIdentity,
	row: ReportRow,
	index: number,
): Record<string, unknown> {
	const failed = row.checks.filter((check) => check.verdict !== "true");
	const line = row.transcript[index];
	return {
		...identityOf(identity, row),
		$ai_trace_id: runId(identity, row),
		message_span_id: `${runId(identity, row)}/${index}`,
		eval_grade: row.grade,
		eval_steps: row.steps,
		eval_halted: row.halted,
		eval_checks_passed: row.checks.length - failed.length,
		eval_checks_total: row.checks.length,
		eval_checks_failed: failed.map((check) => check.name),
		message_index: index,
		message_role: row.transcript[index]?.role,
		message: line ? clamp(line, MESSAGE_BUDGET).content : undefined,
		trace_turns: row.transcript.length,
	};
}
