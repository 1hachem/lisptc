import type { Annotations, StepAnnotations } from "@repo/interpreter/session";
import {
	contentToText,
	ENVELOPE_KEYS,
	envelopeOf,
	type MessageKwargs,
} from "@repo/shared/messages";
import {
	isUserPrompt,
	joinRiding,
	type TranscriptEntry,
	withItsResult,
} from "./repl.ts";
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

function mergeInto(
	into: Record<string, unknown>,
	extra: Record<string, unknown>,
): void {
	for (const [key, value] of Object.entries(extra)) {
		const standing = into[key];
		into[key] =
			Array.isArray(standing) && Array.isArray(value)
				? [...standing, ...value]
				: value;
	}
}

function lastHuman(wire: WireMessage[]): number {
	for (let i = wire.length - 1; i >= 0; i--)
		if (wire[i].type === "human") return i;
	return -1;
}

function annotate(
	message: WireMessage,
	annotations: Record<string, unknown>,
): WireMessage {
	const kwargs = message.additional_kwargs ?? {};
	const meta: Record<string, unknown> = { ...envelopeOf(kwargs).meta };
	mergeInto(meta, annotations);
	return { ...message, additional_kwargs: { ...kwargs, meta } };
}

function riding(message: { additional_kwargs?: MessageKwargs }) {
	return envelopeOf(message.additional_kwargs).riding;
}

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
): "human" | "ai" | "system" | "tool" {
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
		additional_kwargs: { source: event.source },
	};
}

function eventSource(message: ChatMessageInput): string {
	return envelopeOf(message.additional_kwargs).source ?? "system";
}

function toEntry(m: ChatMessageInput): TranscriptEntry {
	const content = contentToText(m.content);
	const role = agentRole(m.type ?? m.role);
	if (role === "system")
		return { role: "user", content, event: { source: eventSource(m) } };
	const rode = riding(m);
	return { role, content, ...(rode === undefined ? {} : { riding: rode }) };
}

function received(input: ChatInput): Annotations | undefined {
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
	for (const entry of (input.messages ?? []).map(toEntry)) {
		const previous = transcript.at(-1);
		if (entry.role === "tool" && previous && isUserPrompt(previous))
			transcript.splice(-1, 1, ...withItsResult(previous, entry));
		else transcript.push(entry);
	}
	return transcript;
}

export interface TurnStreamOptions {
	signal?: AbortSignal;
	onTurn?: (
		messages: WireMessage[],
		revised: ReadonlyMap<number, WireMessage>,
		failure: string | undefined,
	) => Promise<void> | void;
	quiet?: boolean;
	onOutcome?: (outcome: TurnOutcome) => void;
}

export type TurnRun = (
	transcript: TranscriptEntry[],
	received: Annotations | undefined,
	signal: AbortSignal,
) => AsyncIterable<TurnEvent>;

export type TurnOutcome =
	| { readonly answer: string }
	| { readonly held: StepAnnotations }
	| { readonly stopped: string };

type Of<T extends TurnEvent["type"]> = Extract<TurnEvent, { type: T }>;

class TurnWire {
	readonly wire: WireMessage[];
	readonly carried: number;
	readonly revised = new Map<number, WireMessage>();
	steps = 0;
	failure: string | undefined;
	outcome: TurnOutcome = { stopped: "stopped without answering" };
	private held: StepAnnotations | undefined;
	private lastMeta: Record<string, unknown> | undefined;

	constructor(
		input: ChatInput,
		private readonly write: (chunk: Uint8Array) => boolean,
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
	}

	snapshot(): boolean {
		return this.write(sse("values", { messages: this.wire }));
	}

	apply(event: TurnEvent): boolean {
		switch (event.type) {
			case "delta":
				return this.delta(event);
			case "steered":
				this.wire.push(
					event.source === undefined
						? { type: "human", content: event.content, id: event.id }
						: systemEventMessage(
								{ source: event.source, text: event.content },
								event.id,
							),
				);
				return this.snapshot();
			case "evaluated":
				this.wire.push(event.message);
				return this.snapshot();
			case "collected":
				return (
					!this.reviseLastHuman((m) => annotate(m, event.annotations)) ||
					this.snapshot()
				);
			case "rode":
				this.reviseLastHuman((m) => carrying(m, event.text));
				return true;
			case "assistant":
				this.assistant(event);
				return true;
			case "result":
				return this.result(event);
			case "halt":
				this.steps = event.steps;
				this.outcome =
					this.held === undefined
						? { answer: event.answer }
						: { held: this.held };
				if (this.lastMeta) this.lastMeta.steps = event.steps;
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
		const chunk =
			event.reasoning === undefined
				? { type: "ai", id: event.stepId, content: event.text ?? "" }
				: {
						type: "ai",
						id: event.stepId,
						content: "",
						additional_kwargs: { reasoning_content: event.reasoning },
					};
		return this.write(sse("messages", [chunk, {}]));
	}

	private assistant(event: Of<"assistant">): void {
		this.lastMeta = { ...event.meta };
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
		if (event.held) this.held = event.annotations;
		if (this.lastMeta) mergeInto(this.lastMeta, event.annotations.step);
		this.wire.push(toolMessage(event, crypto.randomUUID()));
		return this.snapshot();
	}

	private reviseLastHuman(
		update: (message: WireMessage) => WireMessage,
	): boolean {
		const at = lastHuman(this.wire);
		if (at === -1) return false;
		this.wire[at] = update(this.wire[at]);
		if (at < this.carried) this.revised.set(at, this.wire[at]);
		return true;
	}
}

function carrying(message: WireMessage, text: string): WireMessage {
	return {
		...message,
		additional_kwargs: {
			...message.additional_kwargs,
			riding: joinRiding(riding(message), text),
		},
	};
}

async function record(
	onTurn: TurnStreamOptions["onTurn"],
	turn: TurnWire,
): Promise<void> {
	if (!onTurn) return;
	try {
		await onTurn(turn.wire.slice(turn.carried), turn.revised, turn.failure);
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
	const { onTurn, signal, quiet, onOutcome } = options;
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
			const turn = new TurnWire(input, write);

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
