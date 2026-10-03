import { llmSlot } from "@repo/interpreter/observe";
import type { SessionHooks } from "@repo/interpreter/session";
import {
	captureException,
	captureLlmCall,
	captureReplEval,
	captureTurn,
	type TraceContext,
} from "./telemetry.ts";

export function tracedAgentHooks(hooks: SessionHooks, trace: TraceContext) {
	return {
		agentStarted: hooks.agentStarted.wrappedBy((turn, next) => {
			const observed = hooks.filled(llmSlot);
			if (observed) observed.observe = (call) => captureLlmCall(trace, call);
			next(turn);
		}),
		agentStep: hooks.agentStep.wrappedBy((turn, step, next) => {
			captureReplEval(trace, {
				step: step.step,
				source: step.code,
				output: step.output,
				error: step.error || step.failed,
				latencyMs: step.latencyMs,
			});
			next(turn, step);
		}),
		agentStop: hooks.agentStop,
		agentEnded: hooks.agentEnded.wrappedBy((turn, end, next) => {
			if (end.failure && !end.failure.cancelled)
				captureException(end.failure.error, trace, { steps: end.steps });
			captureTurn(trace, {
				prompt: turn.prompt,
				answer: end.answer,
				steps: end.steps,
				halted: end.halted,
				latencyMs: end.latencyMs,
				error: end.failure?.message,
			});
			next(turn, end);
		}),
	};
}
