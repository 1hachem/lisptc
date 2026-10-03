import { llmSlot } from "@repo/interpreter/observe";
import type {
	Annotations,
	ModelRequest,
	StepAnnotations,
	StepVerdict,
	TurnOutcome,
} from "@repo/interpreter/session";
import type { AgentRepl } from "@repo/repl/repl";
import type { Skipped } from "@repo/shared/lisp-forms";
import {
	type AgentConfig,
	type AgentDelta,
	streamAgent,
	type TokenUsage,
} from "./agent.ts";
import type { Steer } from "./inbox.ts";
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
import {
	captureException,
	captureLlmCall,
	captureReplEval,
	captureTurn,
	type TraceContext,
} from "./telemetry.ts";

export interface TurnOptions {
	repl: AgentRepl;
	threadId?: string;
	config?: AgentConfig;
	signal?: AbortSignal;
	identity?: { distinctId?: string; sessionId?: string };
	maxSteps?: number;
	inbox?: () => Promise<Steer[]>;
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
	| { type: "steered"; id: string; content: string }
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

async function* takeSteers(
	inbox: (() => Promise<Steer[]>) | undefined,
	transcript: TranscriptEntry[],
): AsyncGenerator<TurnEvent, number> {
	let taken = 0;
	for (const steer of (await inbox?.()) ?? []) {
		transcript.push({ role: "user", content: steer.content });
		taken += 1;
		yield { type: "steered", ...steer };
	}
	return taken;
}

function noteEntry(text: string): TranscriptEntry {
	return { role: "tool", content: replResultContent(text, false) };
}

async function* prepareStep(
	repl: AgentRepl,
	transcript: TranscriptEntry[],
	riding: string,
): AsyncGenerator<TurnEvent, string> {
	repl.setConversationVars(snapshotConversation(transcript));
	const { emitted, annotations } = await repl.beginStep();
	if (Object.keys(annotations.step).length > 0)
		yield { type: "collected", annotations: annotations.step };
	return emitted === "" ? riding : emitted;
}

interface Reply {
	full: string;
	reasoning: string;
	usage?: TokenUsage;
}

async function* callModel(
	repl: AgentRepl,
	request: ModelRequest,
	stepId: string,
	call: (request: ModelRequest) => AsyncIterable<AgentDelta>,
): AsyncGenerator<TurnEvent, Reply> {
	const reply: Reply = { full: "", reasoning: "" };
	for await (const delta of repl.modelCall(request, call)) {
		if (delta.usage) {
			reply.usage = delta.usage;
			continue;
		}
		if (delta.reasoning) {
			reply.reasoning += delta.reasoning;
			yield { type: "delta", stepId, reasoning: delta.reasoning };
		} else {
			reply.full += delta.text ?? "";
			yield { type: "delta", stepId, text: delta.text ?? "" };
		}
	}
	return reply;
}

interface Turn {
	readonly repl: AgentRepl;
	readonly transcript: TranscriptEntry[];
	readonly trace: TraceContext;
	readonly ran: { provider: string; model: string };
	readonly maxSteps: number;
	readonly signal?: AbortSignal;
	readonly inbox?: () => Promise<Steer[]>;
	steps: number;
}

type ModelCall = (request: ModelRequest) => AsyncIterable<AgentDelta>;

async function openTurn(
	turn: Turn,
	config: AgentConfig | undefined,
): Promise<{ system: string; call: ModelCall }> {
	const { repl, transcript, trace, signal } = turn;
	const observed = repl.hooks.filled(llmSlot);
	if (observed) observed.observe = (call) => captureLlmCall(trace, call);

	const withheld = repl.takeProseFeedback();
	if (withheld)
		transcript.push({ role: "tool", content: proseFeedbackContent(withheld) });

	const started = await repl.turnStart();
	if (started !== "") transcript.push(noteEntry(started));

	const system = await repl.system(
		config?.system ?? systemPromptFor(repl.interp),
	);
	const traced: AgentConfig = { ...config, trace };
	return {
		system,
		call: (request) =>
			streamAgent(
				[...request.messages],
				{ ...traced, system: request.system },
				{ signal },
			),
	};
}

interface Answered {
	stepId: string;
	startedAt: number;
	code: string;
	reply: Reply;
}

async function* evaluateStep(
	turn: Turn,
	answered: Answered,
): AsyncGenerator<TurnEvent, StepVerdict> {
	const { repl, transcript, trace, ran, maxSteps } = turn;
	const { stepId, startedAt, code, reply } = answered;
	yield {
		type: "assistant",
		stepId,
		code,
		prose: repl.unrun(code),
		...(reply.reasoning ? { reasoning: reply.reasoning } : {}),
		meta: stepMeta(startedAt, reply.usage, ran),
	};
	transcript.push({ role: "assistant", content: code });

	const evalStartedAt = Date.now();
	const { output, display, error, annotations, failed } = await evalCode(
		repl,
		code,
	);
	turn.steps += 1;
	const step = turn.steps;

	captureReplEval(trace, {
		step,
		source: code,
		output,
		error: error || failed,
		latencyMs: Date.now() - evalStartedAt,
	});

	const capped = step >= maxSteps;
	const verdict = repl.stepEnd(
		step,
		repl.takeFinished() ? "halt" : capped ? "capped" : "continue",
	);
	if (verdict === "halt") return verdict;

	yield { type: "result", step, output, display, error, annotations, failed };
	transcript.push({
		role: "tool",
		content: replResultContent(output, error, annotations.step),
	});
	return capped ? "capped" : verdict;
}

async function* settleIfDone(
	turn: Turn,
	step: Stepped,
): AsyncGenerator<TurnEvent, boolean> {
	if (step.verdict === "continue") return false;
	return yield* settle(turn);
}

async function* settle(turn: Turn): AsyncGenerator<TurnEvent, boolean> {
	const { repl, transcript, inbox, signal, steps, maxSteps } = turn;
	if (signal?.aborted) return false;
	const taken = steps > 0 ? yield* takeSteers(inbox, transcript) : 0;
	const settled = await repl.beforeSettle(taken > 0);
	if (settled.emitted !== "") transcript.push(noteEntry(settled.emitted));
	return settled.more && steps < maxSteps;
}

type Ending = Exclude<StepVerdict, "continue"> | "silent";

interface Stepped {
	verdict: StepVerdict | "silent";
	code: string;
	riding: string;
}

async function* runStep(
	turn: Turn,
	opened: { system: string; call: ModelCall },
	riding: string,
): AsyncGenerator<TurnEvent, Stepped> {
	const { repl, transcript } = turn;
	const carried = yield* prepareStep(repl, transcript, riding);
	const stepId = crypto.randomUUID();
	const startedAt = Date.now();
	const messages = repl.context(toLlmMessages(transcript, carried));
	const reply = yield* callModel(
		repl,
		{ system: opened.system, messages },
		stepId,
		opened.call,
	);
	const code = repl.response(reply.full, stripFences);
	if (code === "") return { verdict: "silent", code, riding: carried };
	const verdict = yield* evaluateStep(turn, { stepId, startedAt, code, reply });
	return { verdict, code, riding: carried };
}

function ending(verdict: Ending, code: string, steps: number): TurnEvent {
	if (verdict === "halt") return { type: "halt", answer: code, steps };
	return { type: verdict, steps };
}

function newTurn(options: TurnOptions, messages: TranscriptEntry[]): Turn {
	const { repl, threadId, config, signal, identity, inbox } = options;
	const ran = resolveModel(config?.provider, config?.model);
	return {
		repl,
		transcript: [...messages],
		trace: {
			threadId: threadId ?? crypto.randomUUID(),
			turnId: crypto.randomUUID(),
			distinctId: identity?.distinctId,
			sessionId: identity?.sessionId,
			provider: ran.provider,
			model: ran.model,
		},
		ran,
		maxSteps: options.maxSteps ?? MAX_STEPS,
		signal,
		inbox,
		steps: 0,
	};
}

export async function* runAgentTurn(
	messages: TranscriptEntry[],
	options: TurnOptions,
): AsyncGenerator<TurnEvent> {
	const turn = newTurn(options, messages);
	const { repl, transcript, trace, signal, inbox } = turn;
	const startedAt = Date.now();
	const prompt = lastUserPrompt(transcript);

	let answer = "";
	let failure: string | undefined;
	let outcome: TurnOutcome = "aborted";

	try {
		const opened = await openTurn(turn, options.config);
		let riding = "";
		let drained = false;

		while (!signal?.aborted) {
			if (turn.steps > 0 && !drained) yield* takeSteers(inbox, transcript);
			const step = yield* runStep(turn, opened, riding);
			riding = step.riding;
			drained = step.verdict !== "capped" && (yield* settleIfDone(turn, step));
			if (step.verdict === "continue" || drained) continue;
			outcome = step.verdict;
			if (outcome === "halt") answer = step.code;
			yield ending(step.verdict, step.code, turn.steps);
			break;
		}
	} catch (err) {
		failure = err instanceof Error ? err.message : String(err);
		if (!signal?.aborted) {
			outcome = "failed";
			captureException(err, trace, { steps: turn.steps });
			yield { type: "failed", message: failure, error: err };
		}
	} finally {
		repl.settled(outcome, turn.steps);
		captureTurn(trace, {
			prompt,
			answer,
			steps: turn.steps,
			halted: outcome === "halt",
			latencyMs: Date.now() - startedAt,
			error: failure,
		});
	}
}
