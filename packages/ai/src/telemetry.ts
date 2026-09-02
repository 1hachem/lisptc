/**
 * Agent traces and notes, sent to PostHog.
 *
 * The shape mirrors PostHog's LLM-analytics event schema so a run renders in
 * the trace viewer rather than as loose custom events:
 *
 *   $ai_trace       one per chat turn      (root; the prompt in, the answer out)
 *     $ai_generation  one per model step   (emitted by @posthog/ai's LangChain
 *                                           callback — tokens, cost, latency)
 *     $ai_span        one per REPL eval    (the Lisp program and what it printed;
 *                                           LangChain cannot see this, we emit it)
 *
 * `$ai_trace_id` is the chat's `thread_id`, so every event a conversation ever
 * produced shares one id — the turns, and the `survey sent` events the browser
 * emits when a turn is rated. That is the join key for both the trace view and
 * any insight.
 *
 * With no `POSTHOG_API_KEY` every export here is a no-op, so the agent runs
 * unchanged in a checkout with no PostHog project.
 */

import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { LangChainCallbackHandler } from "@posthog/ai/langchain";
import { analyticsEnv } from "@repo/env/analytics";
import { PostHog } from "posthog-node";

/**
 * Content redaction. Lisp `Secret` values already print as `#<secret:KEY>`, so
 * REPL output is redacted at the source — but an MCP tool result carrying user
 * data is not a secret, and it lands in `$ai_input`/`$ai_output_state` all the
 * same. Setting this keeps the metrics (latency, tokens, error rates, step
 * counts) and drops every prompt, completion and REPL payload.
 */
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
		// The API is long-lived, so the default batching is right; a short
		// interval keeps a local run visible in PostHog while you are still
		// looking at the conversation that produced it.
		flushAt: 20,
		flushInterval: 5_000,
	});
	return client;
}

/** Identity and grouping for everything one chat turn emits. */
export interface TraceContext {
	/** The chat's `thread_id`. Doubles as `$ai_trace_id`. */
	threadId: string;
	/** The person. Absent (local, anonymous) => events carry no person profile. */
	distinctId?: string;
	/**
	 * The browser's PostHog session, forwarded by posthog-js `tracing_headers`.
	 * Joins the trace to the session replay it happened inside; absent whenever
	 * browser analytics is off.
	 */
	sessionId?: string;
	/** `$ai_span_id` of this turn's root, so steps hang off it. */
	turnId: string;
	provider?: string;
	model?: string;
}

// Properties every event in a conversation carries, so a PostHog insight can
// break down by environment or model without touching the trace tree.
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

// PostHog requires a distinct id. An anonymous run is keyed by its thread and
// marked so it never creates a person profile — otherwise every local chat
// would mint a phantom user.
function identify(ctx: { threadId: string; distinctId?: string }): {
	distinctId: string;
	anonymous: Record<string, unknown>;
} {
	return {
		distinctId: ctx.distinctId ?? ctx.threadId,
		anonymous: ctx.distinctId ? {} : { $process_person_profile: false },
	};
}

/**
 * The LangChain callback that reports each model call as an `$ai_generation`.
 * Handed straight to `.stream()`, so `agent.ts` never imports anything
 * PostHog-shaped.
 *
 * `$ai_parent_id` is forced onto the handler's properties because we call the
 * chat model directly rather than through a chain — LangChain has no parent run
 * to report, so without this the generations would float outside the turn.
 */
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

/** One REPL evaluation: the program the model wrote and what it printed. */
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

/**
 * The turn's root event, emitted once the loop stops.
 *
 * `steps` and `halted` are the two numbers worth watching: a turn that used
 * every step and never halted is the agent looping, which reads as a success in
 * the transcript and as a failure here.
 */
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
