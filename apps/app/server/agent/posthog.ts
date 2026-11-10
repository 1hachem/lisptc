import type {
	GenerationRecord,
	RequestContext,
	SpanRecord,
	TraceContext,
	Tracer,
	TurnRecord,
} from "@repo/ai";
import { analyticsEnv } from "@repo/env/analytics";
import { PostHog } from "posthog-node";

const FLUSH_TIMEOUT_MS = 5_000;

interface PosthogGlobals {
	__lisptcPosthog?: PostHog | null;
}

const globals = globalThis as typeof globalThis & PosthogGlobals;

function posthog(): PostHog | null {
	if (globals.__lisptcPosthog !== undefined) return globals.__lisptcPosthog;
	const key = analyticsEnv.POSTHOG_API_KEY;
	if (!key) {
		console.log("[telemetry] POSTHOG_API_KEY unset — agent traces disabled");
		globals.__lisptcPosthog = null;
		return null;
	}
	globals.__lisptcPosthog = new PostHog(key, {
		host: analyticsEnv.POSTHOG_HOST ?? "https://us.i.posthog.com",
		flushAt: 20,
		flushInterval: 5_000,
		enableExceptionAutocapture: true,
	});
	return globals.__lisptcPosthog;
}

function environment(): string {
	return analyticsEnv.POSTHOG_ENVIRONMENT ?? "local";
}

function turnCommon(trace: TraceContext): Record<string, unknown> {
	return {
		$ai_trace_id: trace.threadId,
		thread_id: trace.threadId,
		environment: environment(),
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

function capture(
	event: string,
	trace: TraceContext,
	properties: Record<string, unknown>,
): void {
	const ph = posthog();
	if (!ph) return;
	ph.capture({
		distinctId: trace.distinctId ?? trace.threadId,
		event,
		properties: {
			...properties,
			...(trace.distinctId ? {} : { $process_person_profile: false }),
		},
	});
}

function usageOf(record: GenerationRecord): Record<string, unknown> {
	const usage = record.usage ?? {};
	return {
		...(usage.input === undefined ? {} : { $ai_input_tokens: usage.input }),
		...(usage.output === undefined ? {} : { $ai_output_tokens: usage.output }),
		...(usage.cachedInput === undefined
			? {}
			: { $ai_cache_read_input_tokens: usage.cachedInput }),
	};
}

export function posthogTracer(): Tracer {
	return {
		turn(record) {
			const { trace, content } = record;
			capture("$ai_trace", trace, {
				...turnCommon(trace),
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
			capture("$ai_span", trace, {
				...turnCommon(trace),
				...modelOf(trace.provider, trace.model),
				$ai_span_id: crypto.randomUUID(),
				$ai_parent_id: trace.turnId,
				...timed(record),
				...(content
					? { $ai_input_state: content.input, $ai_output_state: content.output }
					: {}),
			});
		},
		generation(record) {
			const { trace, content } = record;
			capture("$ai_generation", trace, {
				...turnCommon(trace),
				...modelOf(record.provider, record.model),
				$ai_span_id: crypto.randomUUID(),
				$ai_parent_id: trace.turnId,
				...timed(record),
				...usageOf(record),
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
			const ph = posthog();
			if (!ph) return;
			ph.captureException(error, trace.distinctId, {
				environment: environment(),
				...(trace.sessionId ? { $session_id: trace.sessionId } : {}),
				...(trace.threadId
					? { $ai_trace_id: trace.threadId, thread_id: trace.threadId }
					: {}),
				...(trace.turnId ? { $ai_span_id: trace.turnId } : {}),
				...properties,
			});
		},
		withRequest<T>(context: RequestContext, run: () => T): T {
			const ph = posthog();
			return ph ? ph.withContext(context, run) : run();
		},
		async flush() {
			const client = globals.__lisptcPosthog;
			if (!client) return;
			const startedAt = Date.now();
			try {
				await client.shutdown(FLUSH_TIMEOUT_MS);
				console.log(
					`[telemetry] flushed pending events (${Date.now() - startedAt}ms)`,
				);
			} catch (err) {
				console.warn("[telemetry] flush failed:", err);
			}
		},
	};
}
