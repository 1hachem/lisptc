import type { Eval } from "@repo/interpreter/drive";
import type { Middleware } from "@repo/interpreter/hooks";
import { llmSlot } from "@repo/interpreter/observe";
import type {
	AgentEnd,
	AgentStep,
	AgentTurn,
	SessionHooks,
	StepVerdict,
	TurnContext,
} from "@repo/interpreter/session";
import {
	captureException,
	captureLlmCall,
	captureReplEval,
	captureTurn,
	type TraceContext,
} from "./telemetry.ts";

export interface TurnTelemetry {
	readonly turnStart: Middleware<[TurnContext], Eval<void>>;
	readonly stepEnd: Middleware<
		[AgentTurn, AgentStep, StepVerdict],
		StepVerdict
	>;
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
		stepEnd: (turn, step, verdict, next) => {
			captureReplEval(trace, {
				step: step.step,
				source: step.code,
				output: step.output,
				error: step.error || step.failed,
				latencyMs: step.latencyMs,
			});
			return next(turn, step, verdict);
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
