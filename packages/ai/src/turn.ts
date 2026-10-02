import { noOpinion } from "@repo/interpreter/hooks";
import type {
	AgentFailure,
	AgentStep,
	AgentStop,
	AgentTurn,
	Annotations,
	StepAnnotations,
} from "@repo/interpreter/session";
import type { AgentRepl } from "@repo/repl/repl";
import type { Skipped } from "@repo/shared/lisp-forms";
import { type AgentConfig, streamAgent, type TokenUsage } from "./agent.ts";
import { MAX_STEPS, systemPromptFor } from "./prompts/lisp.ts";
import { resolveModel } from "./provider.ts";
import {
	evalCode,
	proseFeedbackContent,
	replResultContent,
	snapshotConversation,
	stripFences,
	type TranscriptEntry,
	toLlmMessages,
} from "./repl.ts";
import type { TraceContext } from "./telemetry.ts";
import { tracedAgentHooks } from "./turn-telemetry.ts";

export interface TurnOptions {
	repl: AgentRepl;
	threadId?: string;
	config?: AgentConfig;
	signal?: AbortSignal;
	identity?: { distinctId?: string; sessionId?: string };
	maxSteps?: number;
}

export interface StepMeta {
	at: string;
	durationMs: number;
	provider: string;
	model: string;
	inputTokens?: number;
	outputTokens?: number;
	cachedInputTokens?: number;
}

export type TurnEvent =
	| { type: "delta"; stepId: string; text?: string; reasoning?: string }
	| {
			type: "assistant";
			stepId: string;
			code: string;
			prose: Skipped[];
			reasoning?: string;
			meta: StepMeta;
	  }
	| {
			type: "result";
			step: number;
			output: string;
			display: string;
			error: boolean;
			annotations: StepAnnotations;
			failed: boolean;
	  }
	| { type: "collected"; annotations: Annotations }
	| { type: "halt"; answer: string; steps: number }
	| { type: "capped"; steps: number }
	| { type: "stopped"; reason: string; steps: number }
	| { type: "silent"; steps: number }
	| { type: "failed"; message: string; error: unknown };

function lastUserPrompt(transcript: TranscriptEntry[]): string {
	return transcript.filter((e) => e.role === "user").at(-1)?.content ?? "";
}

function stepMeta(
	startedAt: number,
	usage: TokenUsage | undefined,
	ran: { provider: string; model: string },
): StepMeta {
	return {
		at: new Date().toISOString(),
		durationMs: Date.now() - startedAt,
		provider: ran.provider,
		model: ran.model,
		...(usage
			? {
					inputTokens: usage.input,
					outputTokens: usage.output,
					...(usage.cachedInput !== undefined
						? { cachedInputTokens: usage.cachedInput }
						: {}),
				}
			: {}),
	};
}

export async function* runAgentTurn(
	messages: TranscriptEntry[],
	options: TurnOptions,
): AsyncGenerator<TurnEvent> {
	const {
		repl,
		threadId,
		config,
		signal,
		identity,
		maxSteps = MAX_STEPS,
	} = options;
	const transcript = [...messages];

	const ran = resolveModel(config?.provider, config?.model);
	const trace: TraceContext = {
		threadId: threadId ?? crypto.randomUUID(),
		turnId: crypto.randomUUID(),
		distinctId: identity?.distinctId,
		sessionId: identity?.sessionId,
		provider: ran.provider,
		model: ran.model,
	};
	const startedAt = Date.now();
	const turn: AgentTurn = {
		interp: repl.interp,
		threadId: trace.threadId,
		turnId: trace.turnId,
		prompt: lastUserPrompt(transcript),
		provider: ran.provider,
		model: ran.model,
	};
	const hooks = tracedAgentHooks(repl.hooks, trace);
	const capOrHalt = (
		_turn: AgentTurn,
		step: AgentStep,
	): AgentStop | undefined => {
		if (step.finished) return { kind: "halt" };
		if (step.step >= maxSteps) return { kind: "cap" };
		return undefined;
	};

	let steps = 0;
	let answer = "";
	let halted = false;
	let failure: AgentFailure | undefined;

	try {
		hooks.agentStarted.run(noOpinion, turn);

		const tracedConfig: AgentConfig = {
			...config,
			system: config?.system ?? systemPromptFor(repl.interp),
			trace,
		};

		const withheld = repl.takeProseFeedback();
		if (withheld)
			transcript.push({
				role: "tool",
				content: proseFeedbackContent(withheld),
			});

		let riding = "";

		while (!signal?.aborted) {
			repl.setConversationVars(snapshotConversation(transcript));

			const { emitted, annotations: collected } = await repl.beginTurn();
			if (emitted !== "") riding = emitted;
			if (Object.keys(collected.step).length > 0)
				yield { type: "collected", annotations: collected.step };

			const stepId = crypto.randomUUID();
			const stepStartedAt = Date.now();
			let full = "";
			let reasoning = "";
			let usage: TokenUsage | undefined;

			for await (const delta of streamAgent(
				toLlmMessages(transcript, riding),
				tracedConfig,
				{ signal },
			)) {
				if (delta.usage) {
					usage = delta.usage;
					continue;
				}
				if (delta.reasoning) {
					reasoning += delta.reasoning;
					yield { type: "delta", stepId, reasoning: delta.reasoning };
				} else {
					full += delta.text ?? "";
					yield { type: "delta", stepId, text: delta.text ?? "" };
				}
			}

			const code = stripFences(full);
			if (code === "") {
				yield { type: "silent", steps };
				break;
			}

			yield {
				type: "assistant",
				stepId,
				code,
				prose: repl.unrun(code),
				...(reasoning ? { reasoning } : {}),
				meta: stepMeta(stepStartedAt, usage, ran),
			};
			transcript.push({ role: "assistant", content: code });

			const evalStartedAt = Date.now();
			const { output, display, error, annotations, failed } = await evalCode(
				repl,
				code,
			);
			steps += 1;

			const step: AgentStep = {
				step: steps,
				code,
				output,
				error,
				failed,
				latencyMs: Date.now() - evalStartedAt,
				finished: repl.takeFinished(),
			};
			hooks.agentStep.run(noOpinion, turn, step);
			const stop = hooks.agentStop.run(capOrHalt, turn, step);

			if (stop?.kind === "halt") {
				answer = code;
				halted = true;
				yield { type: "halt", answer, steps };
				break;
			}

			yield {
				type: "result",
				step: steps,
				output,
				display,
				error,
				annotations,
				failed,
			};
			transcript.push({
				role: "tool",
				content: replResultContent(output, error, annotations.step),
			});

			if (stop?.kind === "cap") {
				yield { type: "capped", steps };
				break;
			}
			if (stop?.kind === "stop") {
				yield { type: "stopped", reason: stop.reason, steps };
				break;
			}
		}
	} catch (err) {
		failure = {
			message: err instanceof Error ? err.message : String(err),
			error: err,
			cancelled: signal?.aborted === true,
		};
		if (!failure.cancelled)
			yield { type: "failed", message: failure.message, error: err };
	} finally {
		hooks.agentEnded.run(noOpinion, turn, {
			answer,
			steps,
			halted,
			latencyMs: Date.now() - startedAt,
			...(failure ? { failure } : {}),
		});
	}
}
