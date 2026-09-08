import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { LangChainCallbackHandler } from "@posthog/ai/langchain";
import { analyticsEnv } from "@repo/env/analytics";
import type { LlmCall } from "@repo/llm/llm";
import { PostHog } from "posthog-node";

const PRIVACY_MODE = process.env.POSTHOG_PRIVACY_MODE === "true";

let client: PostHog | null | undefined;

function posthog(): PostHog | null {
	if (client !== undefined) return client;
	const key = analyticsEnv.POSTHOG_API_KEY;
	if (!key) {
		console.log("[telemetry] POSTHOG_API_KEY unset — agent traces disabled");
		client = null;
		return null;
	}
	client = new PostHog(key, {
		host: analyticsEnv.POSTHOG_HOST ?? "https://us.i.posthog.com",
		flushAt: 20,
		flushInterval: 5_000,
	});
	return client;
}

export interface TraceContext {
	threadId: string;
	distinctId?: string;
	sessionId?: string;
	turnId: string;
	provider?: string;
	model?: string;
}

function turnCommon(ctx: TraceContext): Record<string, unknown> {
	return {
		$ai_trace_id: ctx.threadId,
		thread_id: ctx.threadId,
		environment: analyticsEnv.POSTHOG_ENVIRONMENT ?? "local",
		...(ctx.sessionId ? { $session_id: ctx.sessionId } : {}),
	};
}

function common(ctx: TraceContext): Record<string, unknown> {
	return {
		...turnCommon(ctx),
		...(ctx.provider ? { $ai_provider: ctx.provider } : {}),
		...(ctx.model ? { $ai_model: ctx.model } : {}),
	};
}

function identify(ctx: { threadId: string; distinctId?: string }): {
	distinctId: string;
	anonymous: Record<string, unknown>;
} {
	return {
		distinctId: ctx.distinctId ?? ctx.threadId,
		anonymous: ctx.distinctId ? {} : { $process_person_profile: false },
	};
}

export function traceCallbacks(ctx: TraceContext): BaseCallbackHandler[] {
	const ph = posthog();
	if (!ph) return [];
	return [
		new LangChainCallbackHandler({
			client: ph,
			traceId: ctx.threadId,
			distinctId: ctx.distinctId,
			privacyMode: PRIVACY_MODE,
			properties: { ...common(ctx), $ai_parent_id: ctx.turnId },
		}),
	];
}

export function captureReplEval(
	ctx: TraceContext,
	span: {
		step: number;
		source: string;
		output: string;
		error: boolean;
		latencyMs: number;
	},
): void {
	const ph = posthog();
	if (!ph) return;
	const { distinctId, anonymous } = identify(ctx);
	ph.capture({
		distinctId,
		event: "$ai_span",
		properties: {
			...common(ctx),
			...anonymous,
			$ai_span_id: crypto.randomUUID(),
			$ai_parent_id: ctx.turnId,
			$ai_span_name: `repl eval ${span.step}`,
			$ai_latency: span.latencyMs / 1000,
			$ai_is_error: span.error,
			step: span.step,
			...(PRIVACY_MODE
				? {}
				: {
						$ai_input_state: span.source,
						$ai_output_state: span.output,
					}),
		},
	});
}

export function captureTurn(
	ctx: TraceContext,
	turn: {
		prompt: string;
		answer: string;
		steps: number;
		halted: boolean;
		latencyMs: number;
		error?: string;
	},
): void {
	const ph = posthog();
	if (!ph) return;
	const { distinctId, anonymous } = identify(ctx);
	ph.capture({
		distinctId,
		event: "$ai_trace",
		properties: {
			...common(ctx),
			...anonymous,
			$ai_span_id: ctx.turnId,
			$ai_span_name: "chat turn",
			$ai_latency: turn.latencyMs / 1000,
			$ai_is_error: Boolean(turn.error),
			...(turn.error ? { $ai_error: turn.error } : {}),
			steps: turn.steps,
			halted: turn.halted,
			...(PRIVACY_MODE
				? {}
				: { $ai_input_state: turn.prompt, $ai_output_state: turn.answer }),
		},
	});
}

export function captureLlmCall(ctx: TraceContext, span: LlmCall): void {
	const ph = posthog();
	if (!ph) return;
	const { distinctId, anonymous } = identify(ctx);
	ph.capture({
		distinctId,
		event: "$ai_generation",
		properties: {
			...turnCommon(ctx),
			...anonymous,
			$ai_span_id: crypto.randomUUID(),
			$ai_parent_id: ctx.turnId,
			$ai_span_name: span.builtin,
			$ai_latency: span.latencyMs / 1000,
			$ai_is_error: Boolean(span.error),
			...(span.provider ? { $ai_provider: span.provider } : {}),
			...(span.model ? { $ai_model: span.model } : {}),
			...(span.inputTokens === undefined
				? {}
				: { $ai_input_tokens: span.inputTokens }),
			...(span.outputTokens === undefined
				? {}
				: { $ai_output_tokens: span.outputTokens }),
			...(span.error ? { $ai_error: span.error } : {}),
			structured: span.structured,
			...(PRIVACY_MODE
				? {}
				: {
						$ai_input: span.messages,
						$ai_output_choices: [
							{ role: "assistant", content: span.output ?? "" },
						],
					}),
		},
	});
}

export async function shutdownTelemetry(): Promise<void> {
	const ph = posthog();
	if (ph) await ph.shutdown();
}
