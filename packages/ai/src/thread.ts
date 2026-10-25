import type { AgentRepl } from "@repo/repl/repl";
import type { Awaitable } from "@repo/shared/host";
import type { MessageKwargs } from "@repo/shared/messages";
import type { AgentConfig } from "./agent.ts";
import { evalMessage } from "./eval.ts";
import type { Envelope, Mailbox } from "./mailbox.ts";
import {
	type ChatMessageInput,
	streamTurn,
	systemEventMessage,
	type TurnOutcome,
	type WireMessage,
} from "./stream.ts";
import { runAgentTurn } from "./turn.ts";

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
	identity?: { distinctId?: string; sessionId?: string };
}

export interface ThreadPorts {
	mailbox: Mailbox;
	repl(threadId: string): Awaitable<AgentRepl>;
	transcript: TranscriptStore;
	status: ThreadStatus;
	setup(threadId: string): Promise<TurnSetup>;
}

export interface PostOptions {
	maxSteps?: number;
	signal?: AbortSignal;
	watch?: boolean;
}

export interface Posted {
	opened: Promise<Response | undefined>;
	ended: Promise<TurnOutcome>;
}

interface Tracked {
	readonly options: PostOptions;
	readonly open: (stream: Response | undefined) => void;
	readonly end: (outcome: TurnOutcome) => void;
}

const WITHDRAWN: TurnOutcome = { stopped: "withdrawn before a turn took it" };

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

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function drained(response: Response): Promise<void> {
	await response.body?.pipeTo(new WritableStream());
}

export class Thread {
	private running = false;
	private posted = 0;
	private readonly tracked = new Map<string, Tracked>();

	constructor(
		readonly id: string,
		private readonly ports: ThreadPorts,
	) {}

	async post(envelope: Envelope, options: PostOptions = {}): Promise<Posted> {
		let open: Tracked["open"] = () => {};
		let end: Tracked["end"] = () => {};
		const opened = new Promise<Response | undefined>((done) => {
			open = done;
		});
		const ended = new Promise<TurnOutcome>((done) => {
			end = done;
		});
		this.tracked.set(envelope.id, { options, open, end });
		await this.ports.mailbox.post(this.id, envelope);
		this.posted += 1;
		if (!this.running) {
			this.running = true;
			void this.drive();
		}
		return { opened, ended };
	}

	async withdraw(id: string): Promise<boolean> {
		const withdrawn = await this.ports.mailbox.withdraw(this.id, id);
		if (withdrawn) this.release(id, undefined, WITHDRAWN);
		return withdrawn;
	}

	private release(
		id: string,
		stream: Response | undefined,
		outcome?: TurnOutcome,
	): void {
		const tracked = this.tracked.get(id);
		if (tracked === undefined) return;
		tracked.open(stream);
		if (outcome === undefined) return;
		tracked.end(outcome);
		this.tracked.delete(id);
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
			for (const taken of consumed) this.release(taken, undefined, outcome);
		};
		let prepared: Awaited<ReturnType<Thread["prepare"]>>;
		try {
			await ports.status.start(id);
			prepared = await this.prepare(opening);
		} catch (error) {
			await ports.status
				.settle(id, errorText(error))
				.catch((unsettled: unknown) =>
					console.error(`[ai] thread=${id} was not settled:`, unsettled),
				);
			endAll({ stopped: `failed: ${errorText(error)}` });
			return;
		}
		const { setup, history, quiet, repl } = prepared;
		const deadline =
			setup.deadlineMs === undefined
				? undefined
				: AbortSignal.timeout(setup.deadlineMs);
		const signal = AbortSignal.any(
			[budget.signal, deadline].filter(
				(s): s is AbortSignal => s !== undefined,
			),
		);
		let finished: (outcome: TurnOutcome) => void = () => {};
		const outcome = new Promise<TurnOutcome>((done) => {
			finished = done;
		});
		console.log(`[ai] thread=${id} turn messages=${history.length}`);
		const response = streamTurn(
			{ messages: history },
			(transcript, received, aborted) =>
				runAgentTurn(transcript, {
					repl,
					threadId: id,
					config: setup.config,
					signal: aborted,
					identity: setup.identity,
					runsForms: setup.runsForms,
					received,
					...(budget.maxSteps === undefined
						? {}
						: { maxSteps: budget.maxSteps }),
					inbox: async () => {
						const taken = await ports.mailbox.take(id);
						for (const envelope of taken) {
							consumed.push(envelope.id);
							this.release(envelope.id, undefined);
						}
						return taken;
					},
				}),
			{
				signal,
				quiet,
				onTurn: (produced, revised, failure) =>
					this.record(history, produced, revised, {
						failure,
						late: deadline?.aborted === true,
					}),
				onOutcome: finished,
			},
		);
		if (budget.watch === true) this.release(opening.id, response);
		else void drained(response);
		endAll(await outcome);
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
		ending: { failure: string | undefined; late: boolean },
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
			await ports.status.settle(
				id,
				ending.failure ??
					(ending.late ? "the turn ran past its deadline" : undefined),
			);
		}
	}
}
