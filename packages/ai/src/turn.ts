import type { ConversationRecord } from "@repo/interpreter/conversation";
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
import {
	isPrompt,
	type Line,
	lineChat,
	lineRecord,
	mailLine,
	type PostedLine,
	ranByUser,
} from "./line.ts";
import type { Mail } from "./mailbox.ts";
import { MAX_STEPS, systemPromptFor } from "./prompts/lisp.ts";
import { evalCode, replResultContent, stripFences } from "./repl.ts";
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
	inbox?: () => Promise<Mail[]>;
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
	| { type: "noted"; line: PostedLine }
	| { type: "steered"; id: string; line: PostedLine }
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

function lastUserPrompt(lines: readonly Line[]): string {
	return lines.filter(isPrompt).at(-1)?.text ?? "";
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

interface Noted {
	readonly notes: readonly ConversationRecord[];
	readonly entries: readonly Entry[];
}

function* noting(
	lines: Line[],
	notes: readonly ConversationRecord[],
): Generator<TurnEvent> {
	for (const record of notes) {
		const line = { kind: "record", record } as const;
		lines.push(line);
		yield { type: "noted", line };
	}
}

function seed({ repl, lines, steps }: Turn): void {
	repl.seed(lines.map(lineRecord), steps);
}

async function* through<T extends Noted>(
	turn: Turn,
	run: (repl: AgentRepl) => Promise<T>,
	about?: string,
): AsyncGenerator<TurnEvent, T> {
	seed(turn);
	const ran = await run(turn.repl);
	yield* recorded(ran.entries, about);
	yield* noting(turn.lines, ran.notes);
	return ran;
}

async function* takeSteers({
	repl,
	inbox,
	lines,
	runsForms,
}: Turn): AsyncGenerator<TurnEvent, number> {
	let taken = 0;
	for (const mail of (await inbox?.()) ?? []) {
		const line = mailLine(mail);
		yield { type: "steered", id: mail.id, line };
		const evaluated =
			runsForms && mail.kind === "user" && mail.forms
				? await evalMessage(repl, mail.text)
				: undefined;
		if (evaluated === undefined) {
			lines.push(line);
			taken += 1;
			continue;
		}
		const { message, quiet, entries, notes } = evaluated;
		lines.push(line, ranByUser(message.content));
		if (!quiet) taken += 1;
		yield { type: "evaluated", message };
		yield* recorded(entries);
		yield* noting(lines, notes);
	}
	return taken;
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
	readonly lines: Line[];
	readonly trace: TraceContext;
	readonly ran: { provider: string; model: string };
	readonly maxSteps: number;
	readonly signal?: AbortSignal;
	readonly inbox?: () => Promise<Mail[]>;
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
	const { trace, signal, received, telemetry } = turn;
	yield* through(turn, (repl) => repl.turnStart(telemetry.turnStart));
	if (received !== undefined)
		yield* through(turn, (repl) => repl.received(received, telemetry.received));

	const system =
		config?.system ??
		withInstructions(systemPromptFor(turn.repl.interp), config);
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
	const { repl, lines, ran, maxSteps } = turn;
	const { stepId, startedAt, code, reply } = answered;
	yield {
		type: "assistant",
		stepId,
		code,
		prose: repl.unrun(code),
		...(reply.reasoning ? { reasoning: reply.reasoning } : {}),
		meta: stepMeta(startedAt, reply.usage, ran),
	};
	lines.push({ kind: "assistant", text: code });
	seed(turn);

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
	if (verdict === "halt" && !held) {
		yield* noting(lines, notes);
		return verdict;
	}
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
	lines.push({ kind: "result", text: replResultContent(output, error) });
	yield* noting(lines, notes);
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
	const { signal, steps, maxSteps } = turn;
	if (signal?.aborted) return false;
	const taken = steps > 0 ? yield* takeSteers(turn) : 0;
	const settled = yield* through(turn, (repl) => repl.beforeSettle(taken > 0));
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
	const stepId = crypto.randomUUID();
	yield* through(turn, (repl) => repl.beginStep(), stepId);
	const startedAt = Date.now();
	const messages = turn.lines.map(lineChat);
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

function newTurn(options: TurnOptions, messages: readonly Line[]): Turn {
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
		lines: [...messages],
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
	messages: readonly Line[],
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
