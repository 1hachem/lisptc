import type { Said } from "@repo/interpreter/conversation";
import { systemPromptKind } from "@repo/journal-catalog/system";
import {
	ENTRY_TYPE,
	type Entry,
	entriesIn,
	type Received,
	view,
} from "@repo/shared/journal";
import {
	contentToText,
	ENVELOPE_KEYS,
	envelopeOf,
	lighten,
	type MessageKwargs,
} from "@repo/shared/messages";
import { isUserPrompt, type TranscriptEntry, userRanEvent } from "./repl.ts";
import type { SystemEvent } from "./system-event.ts";
import { toolMessage } from "./tool-message.ts";
import type { TurnEvent } from "./turn.ts";

export interface ChatMessageInput {
	id?: string;
	type?: string;
	role?: string;
	content?: unknown;
	additional_kwargs?: MessageKwargs;
}

export interface ChatInput {
	messages?: ChatMessageInput[];
}

export interface WireMessage {
	type: string;
	content: string;
	id: string;
	additional_kwargs?: MessageKwargs;
}

const encoder = new TextEncoder();

const ENVELOPE: ReadonlySet<string> = new Set(ENVELOPE_KEYS);

export function entryMessage(
	entry: Entry,
	id: string = crypto.randomUUID(),
	kwargs: MessageKwargs = {},
): WireMessage {
	return {
		type: ENTRY_TYPE,
		content: "",
		id,
		additional_kwargs: {
			...kwargs,
			kind: entry.kind,
			value: entry.value,
			...(entry.about === undefined ? {} : { about: entry.about }),
		},
	};
}

const ENTRY_SNAPSHOT_MS = 100;

function sse(event: string, data: unknown): Uint8Array {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function agentRole(type: string | undefined): TranscriptEntry["role"] {
	if (type === "ai" || type === "assistant") return "assistant";
	if (type === "system") return "system";
	if (type === "tool") return "tool";
	return "user";
}

function wireType(
	type: string | undefined,
): "human" | "ai" | "system" | "tool" | typeof ENTRY_TYPE {
	if (type === ENTRY_TYPE) return ENTRY_TYPE;
	if (type === "ai" || type === "assistant") return "ai";
	if (type === "system") return "system";
	if (type === "tool") return "tool";
	return "human";
}

export function systemEventMessage(
	event: SystemEvent,
	id: string,
): WireMessage {
	return {
		type: "system",
		content: event.text,
		id,
		additional_kwargs: {
			source: event.source,
			...(event.failed ? { failed: true } : {}),
			...(event.noted ? { noted: true } : {}),
		},
	};
}

export function noteMessage(note: Said, id: string): WireMessage {
	return {
		type: "system",
		content: note.content,
		id,
		additional_kwargs: { source: note.source ?? "system", noted: true },
	};
}

function toEntry(m: ChatMessageInput): TranscriptEntry {
	const content = contentToText(m.content);
	const role = agentRole(m.type ?? m.role);
	if (role !== "system") return { role, content };
	const { source = "system", noted } = envelopeOf(m.additional_kwargs);
	return noted
		? { role: "system", content, source }
		: { role: "user", content, event: { source } };
}

function received(input: ChatInput): Received | undefined {
	const newest = input.messages?.at(-1);
	if (newest === undefined || wireType(newest.type ?? newest.role) !== "human")
		return undefined;
	const carried = Object.entries(newest.additional_kwargs ?? {}).filter(
		([key]) => !ENVELOPE.has(key),
	);
	return carried.length === 0 ? undefined : Object.fromEntries(carried);
}

function toTranscript(input: ChatInput): TranscriptEntry[] {
	const transcript: TranscriptEntry[] = [];
	const read = (input.messages ?? []).filter(
		(m) =>
			wireType(m.type ?? m.role) !== ENTRY_TYPE &&
			(agentRole(m.type ?? m.role) !== "tool" ||
				envelopeOf(m.additional_kwargs).quiet !== true),
	);
	for (const entry of read.map(toEntry)) {
		const previous = transcript.at(-1);
		if (entry.role === "tool" && previous && isUserPrompt(previous))
			transcript.push(userRanEvent(entry));
		else transcript.push(entry);
	}
	return transcript;
}

export interface TurnStreamOptions {
	signal?: AbortSignal;
	onStep?: (produced: WireMessage[]) => Promise<void> | void;
	onTurn?: (
		messages: WireMessage[],
		failure: string | undefined,
	) => Promise<void> | void;
	quiet?: boolean;
	onOutcome?: (outcome: TurnOutcome) => void;
	onOpen?: (insert: (message: WireMessage) => boolean) => void;
}

export type TurnRun = (
	transcript: TranscriptEntry[],
	received: Received | undefined,
	signal: AbortSignal,
) => AsyncIterable<TurnEvent>;

export type TurnOutcome =
	| { readonly answer: string }
	| { readonly held: readonly Entry[]; readonly message: string }
	| { readonly stopped: string };

type Of<T extends TurnEvent["type"]> = Extract<TurnEvent, { type: T }>;

class TurnWire {
	readonly wire: WireMessage[];
	readonly carried: number;
	steps = 0;
	failure: string | undefined;
	outcome: TurnOutcome = { stopped: "stopped without answering" };
	private held: { held: readonly Entry[]; message: string } | undefined;
	private stepEntries: Entry[] = [];
	private lastMeta: Record<string, unknown> | undefined;
	private lastAnswer = -1;
	private flushed: number;
	private pendingSnapshot: ReturnType<typeof setTimeout> | undefined;
	private recorded: Promise<void> = Promise.resolve();
	private sealed = false;

	constructor(
		input: ChatInput,
		private readonly write: (chunk: Uint8Array) => boolean,
		private readonly onStep: TurnStreamOptions["onStep"],
	) {
		this.wire = (input.messages ?? []).map((m, i) => ({
			type: wireType(m.type ?? m.role),
			content: contentToText(m.content),
			id: m.id ?? `msg-${i}`,
			...(m.additional_kwargs
				? { additional_kwargs: m.additional_kwargs }
				: {}),
		}));
		this.carried = this.wire.length;
		this.flushed = this.carried;
	}

	snapshot(): boolean {
		this.settleSnapshot();
		return this.write(sse("values", { messages: lighten(this.wire) }));
	}

	private settleSnapshot(): void {
		if (this.pendingSnapshot === undefined) return;
		clearTimeout(this.pendingSnapshot);
		this.pendingSnapshot = undefined;
	}

	private snapshotSoon(): boolean {
		this.pendingSnapshot ??= setTimeout(() => {
			this.pendingSnapshot = undefined;
			this.snapshot();
		}, ENTRY_SNAPSHOT_MS);
		return true;
	}

	private recordEntry(entry: Entry): void {
		const superseded = entry.supersedes ? this.unflushedOf(entry) : -1;
		if (superseded === -1) {
			this.stepEntries.push(entry);
			this.wire.push(entryMessage(entry));
			return;
		}
		const { id } = this.wire[superseded];
		this.wire[superseded] = entryMessage(entry, id);
		const held = this.stepEntries.findIndex(
			(e) => e.kind === entry.kind && e.about === entry.about,
		);
		if (held === -1) this.stepEntries.push(entry);
		else this.stepEntries[held] = entry;
	}

	private recordSystemPrompt(text: string, tokens: number): boolean {
		if (this.lastSystemPrompt() === text) return true;
		this.wire.push(
			entryMessage({
				id: crypto.randomUUID(),
				kind: systemPromptKind.name,
				value: { text, tokens },
			}),
		);
		return this.snapshotSoon();
	}

	private lastSystemPrompt(): string | undefined {
		return view(entriesIn(this.wire), systemPromptKind).at(-1)?.text;
	}

	private unflushedOf(entry: Entry): number {
		for (let at = this.wire.length - 1; at >= this.flushed; at--) {
			const kwargs = this.wire[at].additional_kwargs;
			if (
				this.wire[at].type === ENTRY_TYPE &&
				kwargs?.kind === entry.kind &&
				kwargs?.about === entry.about
			)
				return at;
		}
		return -1;
	}

	flush(): void {
		const onStep = this.onStep;
		if (onStep === undefined || this.flushed === this.wire.length) return;
		const produced = this.wire.slice(this.flushed);
		this.flushed = this.wire.length;
		this.recorded = this.recorded
			.then(() => onStep(produced))
			.catch((error) => console.error("[ai] a step was not recorded:", error));
	}

	insert(message: WireMessage): boolean {
		if (this.sealed) return false;
		this.wire.push(message);
		this.flush();
		this.snapshot();
		return true;
	}

	async unrecorded(): Promise<WireMessage[]> {
		if (this.pendingSnapshot !== undefined) this.snapshot();
		this.sealed = true;
		this.flush();
		await this.recorded;
		return this.wire.slice(this.flushed);
	}

	apply(event: TurnEvent): boolean {
		switch (event.type) {
			case "delta":
				return this.delta(event);
			case "entry":
				this.recordEntry(event.entry);
				return this.snapshotSoon();
			case "system":
				return this.recordSystemPrompt(event.prompt, event.tokens);
			case "steered":
				this.wire.push(
					event.source === undefined
						? { type: "human", content: event.content, id: event.id }
						: systemEventMessage(
								{
									source: event.source,
									text: event.content,
									failed: event.failed,
									noted: event.noted,
								},
								event.id,
							),
				);
				return this.snapshot();
			case "evaluated":
				this.wire.push(event.message);
				return this.snapshot();
			case "noted":
				this.wire.push(noteMessage(event.note, crypto.randomUUID()));
				return this.snapshot();
			case "assistant":
				this.assistant(event);
				return true;
			case "result":
				return this.result(event);
			case "halt":
				this.steps = event.steps;
				this.outcome = this.held ?? { answer: event.answer };
				if (this.lastMeta && this.lastAnswer >= this.flushed)
					this.lastMeta.steps = event.steps;
				this.snapshot();
				return true;
			case "capped":
				this.steps = event.steps;
				this.outcome = {
					stopped: `used its ${event.steps} steps without answering`,
				};
				return true;
			case "silent":
				this.steps = event.steps;
				this.outcome = { stopped: "replied with nothing" };
				console.error(
					`[ai] the model returned an empty reply after ${event.steps} step(s)`,
				);
				return true;
			case "failed":
				console.error("[ai] chat stream failed:", event.error);
				this.failure = event.message;
				this.outcome = { stopped: `failed: ${event.message}` };
				this.write(
					sse("error", { error: "AgentError", message: event.message }),
				);
				return true;
		}
	}

	private delta(event: Of<"delta">): boolean {
		const chunk = event.reasoning
			? {
					type: "ai",
					id: event.stepId,
					content: "",
					additional_kwargs: { reasoning_content: event.reasoning },
				}
			: event.text
				? { type: "ai", id: event.stepId, content: event.text }
				: undefined;
		return chunk === undefined || this.write(sse("messages", [chunk, {}]));
	}

	private assistant(event: Of<"assistant">): void {
		this.lastMeta = { ...event.meta };
		this.stepEntries = [];
		this.lastAnswer = this.wire.length;
		this.wire.push({
			type: "ai",
			content: event.code,
			id: event.stepId,
			additional_kwargs: {
				...(event.reasoning ? { reasoning_content: event.reasoning } : {}),
				prose: event.prose,
				meta: this.lastMeta,
			},
		});
	}

	private result(event: Of<"result">): boolean {
		this.steps = event.step;
		const message = crypto.randomUUID();
		if (event.held) this.held = { held: [...this.stepEntries], message };
		this.wire.push(toolMessage(event, message));
		this.flush();
		return this.snapshot();
	}
}

async function record(
	onTurn: TurnStreamOptions["onTurn"],
	turn: TurnWire,
): Promise<void> {
	const unrecorded = await turn.unrecorded();
	if (!onTurn) return;
	try {
		await onTurn(unrecorded, turn.failure);
	} catch (error) {
		console.error("[ai] the turn was not recorded:", error);
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function streamTurn(
	input: ChatInput,
	run: TurnRun,
	options: TurnStreamOptions = {},
): Response {
	const { onStep, onTurn, signal, quiet, onOutcome, onOpen } = options;
	const abort = new AbortController();
	if (signal?.aborted) abort.abort();
	else signal?.addEventListener("abort", () => abort.abort(), { once: true });

	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			let closed = false;
			const write = (chunk: Uint8Array): boolean => {
				if (closed || abort.signal.aborted) return false;
				try {
					controller.enqueue(chunk);
					return true;
				} catch {
					closed = true;
					return false;
				}
			};
			const turn = new TurnWire(input, write, onStep);
			onOpen?.((message) => turn.insert(message));

			try {
				turn.snapshot();
				if (!quiet)
					for await (const event of run(
						toTranscript(input),
						received(input),
						abort.signal,
					))
						if (!turn.apply(event)) break;
			} catch (error) {
				console.error("[ai] the turn could not run:", error);
				turn.failure = errorText(error);
				turn.outcome = { stopped: `failed: ${errorText(error)}` };
				write(sse("error", { error: "AgentError", message: errorText(error) }));
			} finally {
				await record(onTurn, turn);
				onOutcome?.(turn.outcome);
				console.log(
					`[ai] chat stream closed after ${turn.steps} step(s)${abort.signal.aborted ? " (client disconnected)" : ""}`,
				);
				closed = true;
				try {
					controller.close();
				} catch {}
			}
		},
		cancel() {
			abort.abort();
		},
	});

	return new Response(body, { headers: SSE_HEADERS });
}

export type ThreadState = "running" | "idle" | "waiting" | "errored";

export type ThreadEvent =
	| { readonly type: "wire"; readonly chunk: Uint8Array }
	| { readonly type: "relayed"; readonly message: WireMessage }
	| {
			readonly type: "status";
			readonly status: ThreadState;
			readonly failure?: string;
	  };

const SSE_HEADERS = {
	"content-type": "text/event-stream; charset=utf-8",
	"cache-control": "no-cache, no-transform",
	connection: "keep-alive",
};

type Client = (chunk: Uint8Array) => boolean;

export class Watchers {
	private readonly clients = new Set<Client>();
	private turn: Uint8Array[] = [];
	private status: Uint8Array = sse("status", { status: "idle" });

	get size(): number {
		return this.clients.size;
	}

	begin(): void {
		this.turn = [];
	}

	publish(event: ThreadEvent): void {
		const chunk = this.encode(event);
		for (const client of this.clients)
			if (!client(chunk)) this.clients.delete(client);
	}

	attach(signal?: AbortSignal): Response {
		let detach = () => {};
		const body = new ReadableStream<Uint8Array>({
			start: (controller) => {
				const client: Client = (chunk) => {
					try {
						controller.enqueue(chunk);
						return true;
					} catch {
						return false;
					}
				};
				detach = () => {
					this.clients.delete(client);
					try {
						controller.close();
					} catch {}
				};
				if (signal?.aborted) return detach();
				signal?.addEventListener("abort", detach, { once: true });
				client(this.status);
				for (const chunk of this.turn) client(chunk);
				this.clients.add(client);
			},
			cancel: () => detach(),
		});
		return new Response(body, { headers: SSE_HEADERS });
	}

	private encode(event: ThreadEvent): Uint8Array {
		switch (event.type) {
			case "wire":
				this.turn.push(event.chunk);
				return event.chunk;
			case "relayed": {
				const chunk = sse("relayed", event.message);
				this.turn.push(chunk);
				return chunk;
			}
			case "status": {
				const { type: _, ...status } = event;
				this.status = sse("status", status);
				return this.status;
			}
		}
	}
}
