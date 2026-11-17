import type { Eval } from "@repo/interpreter/drive";
import type { Middleware } from "@repo/interpreter/hooks";
import { llmSlot } from "@repo/interpreter/observe";
import type {
	AgentEnd,
	AgentTurn,
	SessionHooks,
	TurnContext,
} from "@repo/interpreter/session";
import type { Received } from "@repo/shared/journal";
import {
	captureException,
	captureLlmCall,
	captureReplEval,
	captureTurn,
	type TraceContext,
} from "./telemetry.ts";

interface EvaluatedStep {
	readonly step: number;
	readonly code: string;
	readonly output: string;
	readonly error: boolean;
	readonly failed: boolean;
	readonly latencyMs: number;
}

export interface TurnTelemetry {
	readonly turnStart: Middleware<[TurnContext], Eval<void>>;
	readonly received: Middleware<[TurnContext, Received], Eval<void>>;
	readonly stepEnd: (step: EvaluatedStep) => void;
	readonly settled: Middleware<[AgentTurn, AgentEnd], void>;
}

export function turnTelemetry(
	hooks: SessionHooks,
	trace: TraceContext,
): TurnTelemetry {
	return {
		turnStart: function* (ctx, next) {
			const observed = hooks.filled(llmSlot);
			if (observed) observed.observe = (call) => captureLlmCall(trace, call);
			yield* next(ctx);
		},
		received: function* (ctx, received, next) {
			try {
				yield* next(ctx, received);
			} catch (err) {
				captureException(err, trace, { received: Object.keys(received) });
				throw err;
			}
		},
		stepEnd: (step) => {
			captureReplEval(trace, {
				step: step.step,
				source: step.code,
				output: step.output,
				error: step.error || step.failed,
				latencyMs: step.latencyMs,
			});
		},
		settled: (turn, end, next) => {
			if (end.failure && !end.failure.cancelled)
				captureException(end.failure.error, trace, { steps: end.steps });
			captureTurn(trace, {
				prompt: turn.prompt,
				answer: end.answer,
				steps: end.steps,
				halted: end.outcome === "halt",
				latencyMs: end.latencyMs,
				error: end.failure?.message,
			});
			try {
				next(turn, end);
			} catch (err) {
				captureException(err, trace, { steps: end.steps });
			}
		},
	};
}
