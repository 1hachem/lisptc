import type { Said } from "@repo/interpreter/conversation";
import { ends } from "@repo/interpreter/effects";
import type {
	AgentFailure,
	AgentTurn,
	ModelDelta,
	ModelRequest,
	ModelUsage,
	StepVerdict,
	TurnOutcome,
} from "@repo/interpreter/session";
import { resolveModel } from "@repo/models/providers";
import type { AgentRepl, LiveEntries } from "@repo/repl/repl";
import type { Entry, Received } from "@repo/shared/journal";
import type { Skipped } from "@repo/shared/lisp-forms";
import type { StepMeta } from "@repo/shared/messages";
import { type AgentConfig, streamAgent } from "./agent.ts";
import { evalMessage } from "./eval.ts";
import type { Envelope } from "./mailbox.ts";
import { MAX_STEPS, systemPromptFor } from "./prompts/lisp.ts";
import {
	evalCode,
	isUserPrompt,
	noted,
	replResultContent,
	said,
	stripFences,
	type TranscriptEntry,
	toLlmMessages,
	userRanEvent,
} from "./repl.ts";
import type { TraceContext } from "./telemetry.ts";
import type { ToolMessage } from "./tool-message.ts";
import { type TurnTelemetry, turnTelemetry } from "./turn-telemetry.ts";

export interface TurnOptions {
	repl: AgentRepl;
	threadId?: string;
	config?: AgentConfig;
	signal?: AbortSignal;
	identity?: { distinctId?: string; sessionId?: string };
	maxSteps?: number;
	inbox?: () => Promise<Envelope[]>;
	runsForms?: boolean;
	received?: Received;
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
			failed: boolean;
			held?: true;
			results: readonly string[];
	  }
	| { type: "entry"; entry: Entry }
	| { type: "noted"; note: Said }
	| {
			type: "steered";
			id: string;
			content: string;
			source?: string;
			failed?: true;
			noted?: true;
	  }
	| { type: "evaluated"; message: ToolMessage }
	| { type: "halt"; answer: string; steps: number }
	| { type: "capped"; steps: number }
	| { type: "silent"; steps: number }
	| { type: "failed"; message: string; error: unknown };

function withInstructions(prompt: string, config?: AgentConfig): string {
	return config?.instructions === undefined
		? prompt
		: `${prompt}\n\n${config.instructions}`;
}

function lastUserPrompt(transcript: TranscriptEntry[]): string {
	return transcript.filter(isUserPrompt).at(-1)?.content ?? "";
}

function stepMeta(
	startedAt: number,
	usage: ModelUsage | undefined,
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

function* noting(
	transcript: TranscriptEntry[],
	notes: readonly Said[],
): Generator<TurnEvent> {
	for (const note of notes) {
		transcript.push(noted(note));
		yield { type: "noted", note };
	}
}

async function* takeSteers({
	repl,
	inbox,
	transcript,
	runsForms,
}: Turn): AsyncGenerator<TurnEvent, number> {
	let taken = 0;
	for (const envelope of (await inbox?.()) ?? []) {
		if (envelope.kind === "event") {
			const { id, source, text, failed } = envelope;
			yield {
				type: "steered",
				id,
				content: text,
				source,
				failed,
				noted: envelope.noted,
			};
			transcript.push(
				envelope.noted
					? noted({ role: "system", content: text, source })
					: { role: "user", content: text, event: { source } },
			);
			taken += 1;
			continue;
		}
		const prompt: TranscriptEntry = { role: "user", content: envelope.text };
		yield { type: "steered", id: envelope.id, content: envelope.text };
		const evaluated =
			runsForms && envelope.forms
				? await evalMessage(repl, envelope.text)
				: undefined;
		if (evaluated === undefined) {
			transcript.push(prompt);
			taken += 1;
			continue;
		}
		const { message, quiet, entries, notes } = evaluated;
		if (!quiet) {
			transcript.push(
				prompt,
				userRanEvent({ role: "tool", content: message.content }),
			);
			taken += 1;
		}
		yield { type: "evaluated", message };
		yield* recorded(entries);
		yield* noting(transcript, notes);
	}
	return taken;
}

async function* prepareStep(
	repl: AgentRepl,
	transcript: TranscriptEntry[],
	stepId: string,
): AsyncGenerator<TurnEvent> {
	repl.seed(said(transcript));
	const { notes, entries } = await repl.beginStep();
	yield* recorded(entries, stepId);
	yield* noting(transcript, notes);
}

interface Reply {
	full: string;
	reasoning: string;
	usage?: ModelUsage;
}

async function* callModel(
	request: ModelRequest,
	stepId: string,
	call: ModelCall,
): AsyncGenerator<TurnEvent, Reply> {
	const reply: Reply = { full: "", reasoning: "" };
	for await (const delta of call(request)) {
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
	readonly inbox?: () => Promise<Envelope[]>;
	readonly runsForms: boolean;
	readonly received?: Received;
	readonly agent: AgentTurn;
	readonly telemetry: TurnTelemetry;
	steps: number;
}

type ModelCall = (request: ModelRequest) => AsyncIterable<ModelDelta>;

function* recorded(
	entries: readonly Entry[],
	about?: string,
): Generator<TurnEvent> {
	for (const entry of entries)
		yield {
			type: "entry",
			entry: about === undefined ? entry : { ...entry, about },
		};
}

async function* openTurn(
	turn: Turn,
	config: AgentConfig | undefined,
): AsyncGenerator<TurnEvent, { system: string; call: ModelCall }> {
	const { repl, transcript, trace, signal } = turn;
	repl.seed(said(transcript));
	const started = await repl.turnStart(turn.telemetry.turnStart);
	yield* recorded(started.entries);
	yield* noting(transcript, started.notes);

	if (turn.received !== undefined) {
		const heard = await repl.received(turn.received, turn.telemetry.received);
		yield* recorded(heard.entries);
		yield* noting(transcript, heard.notes);
	}

	const system =
		config?.system ?? withInstructions(systemPromptFor(repl.interp), config);
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

async function* whileRunning<T extends { entries: readonly Entry[] }>(
	stepId: string,
	run: (live: LiveEntries) => Promise<T>,
): AsyncGenerator<TurnEvent, T> {
	const waiting: Entry[] = [];
	const seen = new Set<string>();
	let done = false;
	let wake = () => {};
	const running = run((entry) => {
		waiting.push(entry);
		wake();
	});
	const finish = () => {
		done = true;
		wake();
	};
	running.then(finish, finish);
	for (;;) {
		const entry = waiting.shift();
		if (entry !== undefined) {
			seen.add(entry.id);
			yield* recorded([entry], stepId);
			continue;
		}
		if (done) break;
		await new Promise<void>((resolve) => {
			wake = resolve;
		});
	}
	const ran = await running;
	yield* recorded(
		ran.entries.filter((entry) => !seen.has(entry.id)),
		stepId,
	);
	return ran;
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
	const { output, display, error, effects, notes, failed, held, results } =
		yield* whileRunning(stepId, (live) => evalCode(repl, code, stepId, live));
	turn.steps += 1;
	const step = turn.steps;

	turn.telemetry.stepEnd({
		step,
		code,
		output,
		error,
		failed,
		latencyMs: Date.now() - evalStartedAt,
	});
	const verdict: StepVerdict = ends(effects)
		? "halt"
		: step >= maxSteps
			? "capped"
			: "continue";
	if (verdict === "halt" && !held) return verdict;
	yield {
		type: "result",
		step,
		output,
		display,
		error,
		failed,
		results,
		...(held ? { held: true as const } : {}),
	};
	transcript.push({ role: "tool", content: replResultContent(output, error) });
	yield* noting(transcript, notes);
	return verdict;
}

async function* settleIfDone(
	turn: Turn,
	step: Stepped,
): AsyncGenerator<TurnEvent, boolean> {
	if (step.verdict === "continue") return false;
	return yield* settle(turn);
}

async function* settle(turn: Turn): AsyncGenerator<TurnEvent, boolean> {
	const { repl, transcript, signal, steps, maxSteps } = turn;
	if (signal?.aborted) return false;
	const taken = steps > 0 ? yield* takeSteers(turn) : 0;
	const settled = await repl.beforeSettle(taken > 0);
	yield* recorded(settled.entries);
	yield* noting(transcript, settled.notes);
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
	const stepId = crypto.randomUUID();
	yield* prepareStep(repl, transcript, stepId);
	const startedAt = Date.now();
	const messages = toLlmMessages(transcript);
	const reply = yield* callModel(
		{ system: opened.system, messages },
		stepId,
		opened.call,
	);
	const code = stripFences(reply.full);
	if (code === "") return { verdict: "silent", code };
	const verdict = yield* evaluateStep(turn, {
		stepId,
		startedAt,
		code,
		reply,
	});
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
		runsForms: options.runsForms ?? true,
		received: options.received,
		steps: 0,
	};
}

export async function* runAgentTurn(
	messages: TranscriptEntry[],
	options: TurnOptions,
): AsyncGenerator<TurnEvent> {
	const turn = newTurn(options, messages);
	const { repl, signal } = turn;
	const startedAt = Date.now();

	let answer = "";
	let failure: AgentFailure | undefined;
	let outcome: TurnOutcome = "aborted";

	try {
		const opened = yield* openTurn(turn, options.config);
		let drained = false;

		while (!signal?.aborted) {
			if (turn.steps > 0 && !drained) yield* takeSteers(turn);
			const step = yield* runStep(turn, opened);
			drained = step.verdict !== "capped" && (yield* settleIfDone(turn, step));
			if (step.verdict === "continue" || drained) continue;
			outcome = step.verdict;
			if (outcome === "halt") answer = repl.answer(step.code);
			yield ending(step.verdict, answer, turn.steps);
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
