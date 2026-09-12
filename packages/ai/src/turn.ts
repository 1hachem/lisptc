import type { AgentRepl } from "@repo/repl/repl";
import { type AgentConfig, streamAgent, type TokenUsage } from "./agent.ts";
import { MAX_STEPS, systemPrompt } from "./prompts/lisp.ts";
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
import { getThreadRepl } from "./repl-store.ts";
import {
	captureLlmCall,
	captureReplEval,
	captureTurn,
	type TraceContext,
} from "./telemetry.ts";

export interface TurnOptions {
	repl?: AgentRepl;
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
			reasoning?: string;
			meta: StepMeta;
	  }
	| {
			type: "result";
			step: number;
			output: string;
			display: string;
			error: boolean;
	  }
	| { type: "halt"; answer: string; steps: number }
	| { type: "capped"; steps: number }
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
	options: TurnOptions = {},
): AsyncGenerator<TurnEvent> {
	const { threadId, config, signal, identity, maxSteps = MAX_STEPS } = options;
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
	const prompt = lastUserPrompt(transcript);

	let steps = 0;
	let answer = "";
	let halted = false;
	let failure: string | undefined;

	try {
		const repl = options.repl ?? getThreadRepl(threadId);
		repl.llmObserver = (call) => captureLlmCall(trace, call);

		const tracedConfig: AgentConfig = {
			...config,
			system: config?.system ?? systemPrompt(repl.languageReference),
			trace,
		};

		const withheld = repl.takeProseFeedback();
		if (withheld)
			transcript.push({
				role: "tool",
				content: proseFeedbackContent(withheld),
			});

		while (!signal?.aborted) {
			repl.setConversationVars(snapshotConversation(transcript));

			const stepId = crypto.randomUUID();
			const stepStartedAt = Date.now();
			let full = "";
			let reasoning = "";
			let usage: TokenUsage | undefined;

			for await (const delta of streamAgent(
				toLlmMessages(transcript),
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
				...(reasoning ? { reasoning } : {}),
				meta: stepMeta(stepStartedAt, usage, ran),
			};
			transcript.push({ role: "assistant", content: code });

			const evalStartedAt = Date.now();
			const { output, display, error } = await evalCode(repl, code);
			steps += 1;

			if (repl.takeFinished()) {
				answer = code;
				halted = true;
				yield { type: "halt", answer, steps };
				break;
			}

			captureReplEval(trace, {
				step: steps,
				source: code,
				output,
				error,
				latencyMs: Date.now() - evalStartedAt,
			});

			yield { type: "result", step: steps, output, display, error };
			transcript.push({
				role: "tool",
				content: replResultContent(output, error),
			});

			if (steps >= maxSteps) {
				yield { type: "capped", steps };
				break;
			}
		}
	} catch (err) {
		failure = err instanceof Error ? err.message : String(err);
		if (!signal?.aborted)
			yield { type: "failed", message: failure, error: err };
	} finally {
		captureTurn(trace, {
			prompt,
			answer,
			steps,
			halted,
			latencyMs: Date.now() - startedAt,
			error: failure,
		});
	}
}
