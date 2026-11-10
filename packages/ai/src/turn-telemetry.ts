import type { Eval } from "@repo/interpreter/drive";
import { messageOf } from "@repo/interpreter/errors";
import type { Middleware } from "@repo/interpreter/hooks";
import { type LlmCall, llmSlot } from "@repo/interpreter/observe";
import type {
	AgentEnd,
	AgentStep,
	AgentTurn,
	ModelDelta,
	ModelRequest,
	ModelUsage,
	SessionHooks,
	StepVerdict,
	TurnContext,
} from "@repo/interpreter/session";
import type { Received } from "@repo/shared/journal";
import type { GenerationRecord, TraceContext, Tracer } from "./tracer.ts";

export interface TurnTelemetry {
	readonly turnStart: Middleware<[TurnContext], Eval<void>>;
	readonly received: Middleware<[TurnContext, Received], Eval<void>>;
	readonly stepEnd: Middleware<
		[AgentTurn, AgentStep, StepVerdict],
		StepVerdict
	>;
	readonly settled: Middleware<[AgentTurn, AgentEnd], void>;
	generation(
		request: ModelRequest,
		deltas: AsyncIterable<ModelDelta>,
	): AsyncGenerator<ModelDelta>;
}

function llmGeneration(trace: TraceContext, call: LlmCall): GenerationRecord {
	const usage: Partial<ModelUsage> = {
		...(call.inputTokens === undefined ? {} : { input: call.inputTokens }),
		...(call.outputTokens === undefined ? {} : { output: call.outputTokens }),
	};
	return {
		trace,
		name: call.builtin,
		latencyMs: call.latencyMs,
		failed: Boolean(call.error),
		...(call.error ? { error: call.error } : {}),
		...(call.provider ? { provider: call.provider } : {}),
		...(call.model ? { model: call.model } : {}),
		usage,
		attributes: { structured: call.structured },
		content: { input: call.messages, output: call.output ?? "" },
	};
}

async function* tracedGeneration(
	tracer: Tracer,
	trace: TraceContext,
	request: ModelRequest,
	deltas: AsyncIterable<ModelDelta>,
): AsyncGenerator<ModelDelta> {
	const startedAt = Date.now();
	let output = "";
	let usage: ModelUsage | undefined;
	let error: string | undefined;
	try {
		for await (const delta of deltas) {
			output += delta.text ?? "";
			usage = delta.usage ?? usage;
			yield delta;
		}
	} catch (err) {
		error = messageOf(err);
		throw err;
	} finally {
		tracer.generation({
			trace,
			name: "agent step",
			latencyMs: Date.now() - startedAt,
			failed: error !== undefined,
			...(error === undefined ? {} : { error }),
			...(trace.provider ? { provider: trace.provider } : {}),
			...(trace.model ? { model: trace.model } : {}),
			...(usage ? { usage } : {}),
			content: {
				input: [
					{ role: "system", content: request.system },
					...request.messages,
				],
				output,
			},
		});
	}
}

export function turnTelemetry(
	hooks: SessionHooks,
	tracer: Tracer,
	trace: TraceContext,
): TurnTelemetry {
	return {
		generation: (request, deltas) =>
			tracedGeneration(tracer, trace, request, deltas),
		turnStart: function* (ctx, next) {
			const observed = hooks.filled(llmSlot);
			if (observed)
				observed.observe = (call) =>
					tracer.generation(llmGeneration(trace, call));
			yield* next(ctx);
		},
		received: function* (ctx, received, next) {
			try {
				yield* next(ctx, received);
			} catch (err) {
				tracer.exception({
					error: err,
					trace,
					properties: { received: Object.keys(received) },
				});
				throw err;
			}
		},
		stepEnd: (turn, step, verdict, next) => {
			tracer.span({
				trace,
				name: `repl eval ${step.step}`,
				latencyMs: step.latencyMs,
				failed: step.error || step.failed,
				attributes: { step: step.step },
				content: { input: step.code, output: step.output },
			});
			return next(turn, step, verdict);
		},
		settled: (turn, end, next) => {
			if (end.failure && !end.failure.cancelled)
				tracer.exception({
					error: end.failure.error,
					trace,
					properties: { steps: end.steps },
				});
			const error = end.failure?.message;
			tracer.turn({
				trace,
				name: "chat turn",
				latencyMs: end.latencyMs,
				failed: Boolean(error),
				...(error ? { error } : {}),
				attributes: { steps: end.steps, halted: end.outcome === "halt" },
				content: { prompt: turn.prompt, answer: end.answer },
			});
			try {
				next(turn, end);
			} catch (err) {
				tracer.exception({
					error: err,
					trace,
					properties: { steps: end.steps },
				});
			}
		},
	};
}
