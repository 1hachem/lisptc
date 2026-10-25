import type { AgentRepl } from "@repo/repl/repl";
import type { Awaitable } from "@repo/shared/host";
import type { MessageKwargs } from "@repo/shared/messages";
import type { AgentConfig } from "./agent.ts";
import { exhausted, type Limits, type Usage } from "./budget.ts";
import { evalMessage } from "./eval.ts";
import type { Envelope, Mailbox } from "./mailbox.ts";
import type { TurnRunner } from "./runner.ts";
import {
	type ChatMessageInput,
	streamTurn,
	systemEventMessage,
	type ThreadState,
	type TurnOutcome,
	Watchers,
	type WireMessage,
} from "./stream.ts";
import { runAgentTurn, type TurnEvent } from "./turn.ts";

export interface TranscriptStore {
	read(threadId: string): Promise<ChatMessageInput[]>;
	append(threadId: string, messages: WireMessage[]): Promise<void>;
	annotate(threadId: string, id: string, kwargs: MessageKwargs): Promise<void>;
}

export interface ThreadStatus {
	start(threadId: string): Promise<void>;
	settle(threadId: string, failure?: string): Promise<void>;
}

export interface TurnSetup {
	config?: AgentConfig;
	runsForms: boolean;
	deadlineMs?: number;
	maxSteps?: number;
	identity?: { distinctId?: string; sessionId?: string };
	runner?: TurnRunner;
}

export interface ThreadBudget {
	remaining(): Awaitable<Limits>;
	charge(usage: Usage): void;
}

export interface ThreadPorts {
	mailbox: Mailbox;
	budget?: ThreadBudget;
	repl(threadId: string): Awaitable<AgentRepl>;
	transcript: TranscriptStore;
	status: ThreadStatus;
	setup(threadId: string): Promise<TurnSetup>;
}

export interface PostOptions {
	maxSteps?: number;
	signal?: AbortSignal;
}

export interface Posted {
	ended: Promise<TurnOutcome>;
}

interface Tracked {
	readonly options: PostOptions;
	readonly end: (outcome: TurnOutcome) => void;
}

const WITHDRAWN: TurnOutcome = { stopped: "withdrawn before a turn took it" };

const CANCELLED: TurnOutcome = { stopped: "cancelled" };

function openingMessage(envelope: Envelope): WireMessage {
	if (envelope.kind === "event")
		return systemEventMessage(envelope, envelope.id);
	return {
		id: envelope.id,
		type: "human",
		content: envelope.text,
		...(envelope.annotations === undefined
			? {}
			: { additional_kwargs: envelope.annotations }),
	};
}

function stepCap(...caps: (number | undefined)[]): { maxSteps?: number } {
	const set = caps.filter((cap): cap is number => cap !== undefined);
	return set.length === 0 ? {} : { maxSteps: Math.min(...set) };
}

function deadlineOf(
	setupMs: number | undefined,
	until: number | undefined,
): AbortSignal | undefined {
	const left = until === undefined ? undefined : until - Date.now();
	const ms =
		setupMs === undefined
			? left
			: left === undefined
				? setupMs
				: Math.min(setupMs, left);
	return ms === undefined ? undefined : AbortSignal.timeout(Math.max(ms, 0));
}

async function* billed(
	events: AsyncIterable<TurnEvent>,
	budget: ThreadBudget | undefined,
	overspent: () => void,
): AsyncGenerator<TurnEvent> {
	for await (const event of events) {
		if (budget !== undefined && event.type === "assistant") {
			const { inputTokens = 0, outputTokens = 0 } = event.meta;
			budget.charge({ steps: 1, tokens: inputTokens + outputTokens });
			const left = await budget.remaining();
			if (left.tokens !== undefined && left.tokens <= 0) overspent();
		}
		yield event;
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function settledState(
	outcome: TurnOutcome,
	failure: string | undefined,
): { status: ThreadState; failure?: string } {
	if (failure !== undefined) return { status: "errored", failure };
	return { status: "held" in outcome ? "waiting" : "idle" };
}

export class Thread {
	private running = false;
	private held = false;
	private posted = 0;
	private readonly tracked = new Map<string, Tracked>();
	private readonly watchers = new Watchers();
	private halting: AbortController | undefined;

	constructor(
		readonly id: string,
		private readonly ports: ThreadPorts,
	) {}

	async post(envelope: Envelope, options: PostOptions = {}): Promise<Posted> {
		let end: Tracked["end"] = () => {};
		const ended = new Promise<TurnOutcome>((done) => {
			end = done;
		});
		this.tracked.set(envelope.id, { options, end });
		await this.ports.mailbox.post(this.id, envelope);
		this.posted += 1;
		if (!this.running) {
			this.running = true;
			void this.drive();
		}
		return { ended };
	}

	get busy(): boolean {
		return this.running || this.held || this.watchers.size > 0;
	}

	watch(signal?: AbortSignal): Response {
		return this.watchers.attach(signal);
	}

	stop(): boolean {
		if (this.halting === undefined || this.halting.signal.aborted) return false;
		this.halting.abort();
		return true;
	}

	async cancel(): Promise<boolean> {
		const stopped = this.stop();
		const dropped = await this.ports.mailbox.take(this.id);
		for (const envelope of dropped) this.release(envelope.id, CANCELLED);
		return stopped || dropped.length > 0;
	}

	relay(message: WireMessage): void {
		this.watchers.publish({ type: "relayed", message });
	}

	async withdraw(id: string): Promise<boolean> {
		const withdrawn = await this.ports.mailbox.withdraw(this.id, id);
		if (withdrawn) this.release(id, WITHDRAWN);
		return withdrawn;
	}

	private release(id: string, outcome: TurnOutcome): void {
		this.tracked.get(id)?.end(outcome);
		this.tracked.delete(id);
	}

	private taken(envelope: Envelope): void {
		if (envelope.kind === "event" && envelope.replyTo !== undefined)
			this.relay(systemEventMessage(envelope, envelope.id));
	}

	private async drive(): Promise<void> {
		try {
			for (;;) {
				const seen = this.posted;
				const [next] = await this.ports.mailbox.take(this.id, 1);
				if (next !== undefined) {
					await this.turn(next);
					continue;
				}
				if (this.posted !== seen) continue;
				this.running = false;
				return;
			}
		} catch (error) {
			this.running = false;
			console.error(`[ai] thread=${this.id} stopped driving:`, error);
		}
	}

	private async turn(opening: Envelope): Promise<void> {
		const { id, ports } = this;
		const budget = this.tracked.get(opening.id)?.options ?? {};
		const consumed = [opening.id];
		const endAll = (outcome: TurnOutcome) => {
			for (const taken of consumed) this.release(taken, outcome);
		};
		this.held = false;
		this.watchers.begin();
		this.watchers.publish({ type: "status", status: "running" });
		this.taken(opening);
		const halting = new AbortController();
		this.halting = halting;
		let prepared: Awaited<ReturnType<Thread["prepare"]>>;
		let left: Limits = {};
		try {
			left = (await ports.budget?.remaining()) ?? {};
			const spent = exhausted(left);
			if (spent !== undefined) throw new Error(`the thread is ${spent}`);
			await ports.status.start(id);
			prepared = await this.prepare(opening);
		} catch (error) {
			await ports.status
				.settle(id, errorText(error))
				.catch((unsettled: unknown) =>
					console.error(`[ai] thread=${id} was not settled:`, unsettled),
				);
			this.watchers.publish({
				type: "status",
				status: "errored",
				failure: errorText(error),
			});
			if (this.halting === halting) this.halting = undefined;
			endAll({ stopped: `failed: ${errorText(error)}` });
			return;
		}
		const { setup, history, quiet, repl } = prepared;
		const deadline = deadlineOf(setup.deadlineMs, left.deadline);
		const overspent = new AbortController();
		const signal = AbortSignal.any(
			[halting.signal, overspent.signal, budget.signal, deadline].filter(
				(s): s is AbortSignal => s !== undefined,
			),
		);
		let failed: string | undefined;
		let finished: (outcome: TurnOutcome) => void = () => {};
		const outcome = new Promise<TurnOutcome>((done) => {
			finished = done;
		});
		console.log(`[ai] thread=${id} turn messages=${history.length}`);
		const response = streamTurn(
			{ messages: history },
			(transcript, received, aborted) =>
				billed(
					setup.runner?.(transcript, { repl, signal: aborted }) ??
						runAgentTurn(transcript, {
							repl,
							threadId: id,
							config: setup.config,
							signal: aborted,
							identity: setup.identity,
							runsForms: setup.runsForms,
							received,
							...stepCap(budget.maxSteps, setup.maxSteps, left.steps),
							inbox: async () => {
								const taken = await ports.mailbox.take(id);
								for (const envelope of taken) {
									consumed.push(envelope.id);
									this.taken(envelope);
								}
								return taken;
							},
						}),
					ports.budget,
					() => overspent.abort(),
				),
			{
				signal,
				quiet,
				onTurn: (produced, revised, failure) => {
					failed =
						failure ??
						(deadline?.aborted === true
							? "the turn ran past its deadline"
							: overspent.signal.aborted
								? "the turn ran out of tokens"
								: undefined);
					return this.record(history, produced, revised, failed);
				},
				onOutcome: finished,
			},
		);
		await this.pump(response);
		const ended = await outcome;
		if (this.halting === halting) this.halting = undefined;
		this.held = "held" in ended;
		this.watchers.publish({ type: "status", ...settledState(ended, failed) });
		endAll(ended);
	}

	private async pump(response: Response): Promise<void> {
		const reader = response.body?.getReader();
		if (reader === undefined) return;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return;
			this.watchers.publish({ type: "wire", chunk: value });
		}
	}

	private async prepare(opening: Envelope) {
		const { id, ports } = this;
		const setup = await ports.setup(id);
		const repl = await ports.repl(id);
		await ports.transcript.append(id, [openingMessage(opening)]);
		let quiet = false;
		if (opening.kind === "user" && opening.forms && setup.runsForms) {
			const evaluated = await evalMessage(repl, opening.text);
			if (evaluated !== undefined) {
				await ports.transcript.append(id, [evaluated.message]);
				quiet = evaluated.quiet;
			}
		}
		const history = await ports.transcript.read(id);
		return { setup, repl, history, quiet };
	}

	private async record(
		history: ChatMessageInput[],
		produced: WireMessage[],
		revised: ReadonlyMap<number, WireMessage>,
		failure: string | undefined,
	): Promise<void> {
		const { id, ports } = this;
		try {
			for (const [at, message] of revised) {
				const stored = history[at]?.id;
				if (stored === undefined || message.additional_kwargs === undefined)
					continue;
				await ports.transcript.annotate(id, stored, message.additional_kwargs);
			}
			if (produced.length > 0) await ports.transcript.append(id, produced);
		} finally {
			await ports.status.settle(id, failure);
		}
	}
}
