import type { TraceContext, Tracer } from "@repo/ai";
import type { ChatMessage } from "@repo/shared/messages";
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

function asked(line: TranscriptLine): ChatMessage {
	return {
		role: line.role === "assistant" ? "assistant" : "user",
		content: line.content,
	};
}

export function traceRun(
	tracer: Tracer,
	identity: RunIdentity,
	row: ReportRow,
	budget = TRACE_BUDGET,
): void {
	const id = runId(identity, row);
	const failed = row.checks.filter((check) => check.verdict !== "true");
	const trace: TraceContext = {
		threadId: id,
		turnId: `${id}/run`,
		provider: row.provider,
		model: row.model,
	};
	const shared = identityOf(identity, row);

	tracer.turn({
		trace,
		name: `eval ${row.case}`,
		latencyMs: row.durationMs,
		failed: !row.halted,
		attributes: {
			...shared,
			eval_grade: row.grade,
			eval_steps: row.steps,
			eval_halted: row.halted,
			eval_input_tokens: row.inputTokens,
			eval_output_tokens: row.outputTokens,
			eval_checks_passed: row.checks.length - failed.length,
			eval_checks_total: row.checks.length,
			eval_checks_failed: failed.map((check) => check.name),
		},
		content: {
			prompt:
				row.transcript.find((line) => line.role === "user")?.content ?? "",
			answer: row.answer,
		},
	});

	let step = 0;
	row.transcript.forEach((line, i) => {
		const attributes = {
			...shared,
			message_index: i,
			message_span_id: `${id}/${i}`,
		};
		if (line.role === "assistant") {
			step += 1;
			tracer.generation({
				trace,
				name: `step ${step}`,
				latencyMs: 0,
				failed: false,
				provider: row.provider,
				model: row.model,
				attributes: { ...attributes, step },
				content: {
					input: fitTrace(row.transcript.slice(0, i), i - 1, budget).lines.map(
						asked,
					),
					output: line.content,
				},
			});
		}
		if (line.role === "tool") {
			tracer.span({
				trace,
				name: `repl eval ${step}`,
				latencyMs: 0,
				failed: false,
				attributes: { ...attributes, step },
				content: {
					input: row.transcript[i - 1]?.content ?? "",
					output: clamp(line, budget).content,
				},
			});
		}
	});
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
