import type {
	AgentFailure,
	AgentTurn,
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
	isUserPrompt,
	joinRiding,
	proseFeedbackContent,
	replResultContent,
	snapshotConversation,
	stripFences,
	type TranscriptEntry,
	toLlmMessages,
} from "./repl.ts";
import type { TraceContext } from "./telemetry.ts";
import { type TurnTelemetry, turnTelemetry } from "./turn-telemetry.ts";

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
			riding?: string;
			failed: boolean;
	  }
	| { type: "collected"; annotations: Annotations }
	| { type: "rode"; text: string }
	| { type: "steered"; id: string; content: string }
	| { type: "halt"; answer: string; steps: number }
	| { type: "capped"; steps: number }
	| { type: "silent"; steps: number }
	| { type: "failed"; message: string; error: unknown };

function lastUserPrompt(transcript: TranscriptEntry[]): string {
	return transcript.filter(isUserPrompt).at(-1)?.content ?? "";
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

function ride(transcript: TranscriptEntry[], text: string): boolean {
	let at = transcript.length - 1;
	while (at >= 0 && !isUserPrompt(transcript[at])) at--;
	if (at === -1) return false;
	const carrier = transcript[at];
	transcript[at] = { ...carrier, riding: joinRiding(carrier.riding, text) };
	return true;
}

async function* prepareStep(
	repl: AgentRepl,
	transcript: TranscriptEntry[],
): AsyncGenerator<TurnEvent> {
	repl.setConversationVars(snapshotConversation(transcript));
	const { emitted, annotations } = await repl.beginStep();
	yield* collect(annotations);
	if (emitted !== "" && ride(transcript, emitted))
		yield { type: "rode", text: emitted };
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
	readonly agent: AgentTurn;
	readonly telemetry: TurnTelemetry;
	steps: number;
}

type ModelCall = (request: ModelRequest) => AsyncIterable<AgentDelta>;

function* collect(annotations: StepAnnotations): Generator<TurnEvent> {
	if (Object.keys(annotations.step).length > 0)
		yield { type: "collected", annotations: annotations.step };
}

async function* openTurn(
	turn: Turn,
	config: AgentConfig | undefined,
): AsyncGenerator<TurnEvent, { system: string; call: ModelCall }> {
	const { repl, transcript, trace, signal } = turn;
	const withheld = repl.takeProseFeedback();
	if (withheld)
		transcript.push({ role: "tool", content: proseFeedbackContent(withheld) });

	const started = await repl.turnStart(turn.telemetry.turnStart);
	if (started.emitted !== "") transcript.push(noteEntry(started.emitted));
	yield* collect(started.annotations);

	const { prompt: system, annotations } = await repl.system(
		config?.system ?? systemPromptFor(repl.interp),
	);
	yield* collect(annotations);
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
	const { repl, transcript, ran, maxSteps } = turn;
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
	const { output, display, error, annotations, emitted, failed, held } =
		await evalCode(repl, code);
	turn.steps += 1;
	const step = turn.steps;

	const capped = step >= maxSteps;
	const verdict = repl.stepEnd(
		turn.agent,
		{
			step,
			code,
			output,
			error,
			failed,
			latencyMs: Date.now() - evalStartedAt,
		},
		repl.takeFinished() ? "halt" : capped ? "capped" : "continue",
		turn.telemetry.stepEnd,
	);
	if (verdict === "halt" && !held) return verdict;

	const riding = emitted === "" ? {} : { riding: emitted };
	yield {
		type: "result",
		step,
		output,
		display,
		error,
		annotations,
		failed,
		...riding,
	};
	transcript.push({
		role: "tool",
		content: replResultContent(output, error),
		...riding,
	});
	if (verdict === "halt") return verdict;
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
}

async function* runStep(
	turn: Turn,
	opened: { system: string; call: ModelCall },
): AsyncGenerator<TurnEvent, Stepped> {
	const { repl, transcript } = turn;
	yield* prepareStep(repl, transcript);
	const stepId = crypto.randomUUID();
	const startedAt = Date.now();
	const messages = repl.context(toLlmMessages(transcript));
	const reply = yield* callModel(
		repl,
		{ system: opened.system, messages },
		stepId,
		opened.call,
	);
	const code = repl.response(reply.full, stripFences);
	if (code === "") return { verdict: "silent", code };
	const verdict = yield* evaluateStep(turn, { stepId, startedAt, code, reply });
	return { verdict, code };
}

function ending(verdict: Ending, code: string, steps: number): TurnEvent {
	if (verdict === "halt") return { type: "halt", answer: code, steps };
	return { type: verdict, steps };
}

function newTurn(options: TurnOptions, messages: TranscriptEntry[]): Turn {
	const { repl, threadId, config, signal, identity, inbox } = options;
	const ran = resolveModel(config?.provider, config?.model);
	const trace: TraceContext = {
		threadId: threadId ?? crypto.randomUUID(),
		turnId: crypto.randomUUID(),
		distinctId: identity?.distinctId,
		sessionId: identity?.sessionId,
		provider: ran.provider,
		model: ran.model,
	};
	return {
		repl,
		transcript: [...messages],
		trace,
		agent: {
			get interp() {
				return repl.interp;
			},
			threadId: trace.threadId,
			turnId: trace.turnId,
			prompt: lastUserPrompt(messages),
			provider: ran.provider,
			model: ran.model,
		},
		telemetry: turnTelemetry(repl.hooks, trace),
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
	const { repl, transcript, signal, inbox } = turn;
	const startedAt = Date.now();

	let answer = "";
	let failure: AgentFailure | undefined;
	let outcome: TurnOutcome = "aborted";

	try {
		const opened = yield* openTurn(turn, options.config);
		let drained = false;

		while (!signal?.aborted) {
			if (turn.steps > 0 && !drained) yield* takeSteers(inbox, transcript);
			const step = yield* runStep(turn, opened);
			drained = step.verdict !== "capped" && (yield* settleIfDone(turn, step));
			if (step.verdict === "continue" || drained) continue;
			outcome = step.verdict;
			if (outcome === "halt") answer = step.code;
			yield ending(step.verdict, step.code, turn.steps);
			break;
		}
	} catch (err) {
		failure = {
			message: err instanceof Error ? err.message : String(err),
			error: err,
			cancelled: signal?.aborted === true,
		};
		if (!failure.cancelled) {
			outcome = "failed";
			yield { type: "failed", message: failure.message, error: err };
		}
	} finally {
		repl.settled(
			turn.agent,
			{
				outcome,
				answer,
				steps: turn.steps,
				latencyMs: Date.now() - startedAt,
				...(failure ? { failure } : {}),
			},
			turn.telemetry.settled,
		);
	}
}
