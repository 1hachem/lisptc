import type {
	GenerationRecord,
	SpanRecord,
	TraceContext,
	Tracer,
	TurnRecord,
} from "@repo/ai";

export interface Capturing {
	capture(event: string, properties: Record<string, unknown>): unknown;
	captureException(
		error: unknown,
		properties: Record<string, unknown>,
	): unknown;
}

function traceOf(trace: TraceContext): Record<string, unknown> {
	return {
		$ai_trace_id: trace.threadId,
		...(trace.sessionId ? { $session_id: trace.sessionId } : {}),
	};
}

function modelOf(provider?: string, model?: string): Record<string, unknown> {
	return {
		...(provider ? { $ai_provider: provider } : {}),
		...(model ? { $ai_model: model } : {}),
	};
}

function timed(
	record: TurnRecord | SpanRecord | GenerationRecord,
): Record<string, unknown> {
	return {
		$ai_span_name: record.name,
		$ai_latency: record.latencyMs / 1000,
		$ai_is_error: record.failed,
		...(record.error ? { $ai_error: record.error } : {}),
		...record.attributes,
	};
}

function child(trace: TraceContext): Record<string, unknown> {
	return {
		...traceOf(trace),
		$ai_span_id: crypto.randomUUID(),
		$ai_parent_id: trace.turnId,
	};
}

export function posthogTracer(client: Capturing): Tracer {
	return {
		turn(record) {
			const { trace, content } = record;
			client.capture("$ai_trace", {
				...traceOf(trace),
				...modelOf(trace.provider, trace.model),
				$ai_span_id: trace.turnId,
				...timed(record),
				...(content
					? {
							$ai_input_state: content.prompt,
							$ai_output_state: content.answer,
						}
					: {}),
			});
		},
		span(record) {
			const { trace, content } = record;
			client.capture("$ai_span", {
				...child(trace),
				...modelOf(trace.provider, trace.model),
				...timed(record),
				...(content
					? { $ai_input_state: content.input, $ai_output_state: content.output }
					: {}),
			});
		},
		generation(record) {
			const { trace, content, usage } = record;
			client.capture("$ai_generation", {
				...child(trace),
				...modelOf(record.provider, record.model),
				...timed(record),
				...(usage?.input === undefined
					? {}
					: { $ai_input_tokens: usage.input }),
				...(usage?.output === undefined
					? {}
					: { $ai_output_tokens: usage.output }),
				...(content
					? {
							$ai_input: content.input,
							$ai_output_choices: [
								{ role: "assistant", content: content.output },
							],
						}
					: {}),
			});
		},
		exception({ error, trace, properties }) {
			client.captureException(error, {
				...(trace.threadId ? { $ai_trace_id: trace.threadId } : {}),
				...(trace.turnId ? { $ai_span_id: trace.turnId } : {}),
				...properties,
			});
		},
		withRequest: (_context, run) => run(),
		async flush() {},
	};
}
