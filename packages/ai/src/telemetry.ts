import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { LangChainCallbackHandler } from "@posthog/ai/langchain";
import { analyticsEnv } from "@repo/env/analytics";
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

function common(ctx: TraceContext): Record<string, unknown> {
	return {
		$ai_trace_id: ctx.threadId,
		thread_id: ctx.threadId,
		environment: analyticsEnv.POSTHOG_ENVIRONMENT ?? "local",
		...(ctx.sessionId ? { $session_id: ctx.sessionId } : {}),
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

export async function shutdownTelemetry(): Promise<void> {
	const ph = posthog();
	if (ph) await ph.shutdown();
}
