import type { Annotations } from "@repo/interpreter/session";
import {
	contentToText,
	ENVELOPE_KEYS,
	envelopeOf,
	type MessageKwargs,
} from "@repo/shared/messages";
import type { AgentConfig } from "./agent.ts";
import type { Steer, SteerInbox } from "./inbox.ts";
import {
	isUserPrompt,
	joinRiding,
	type TranscriptEntry,
	withItsResult,
} from "./repl.ts";
import { type ReplSource, replFrom } from "./repl-store.ts";
import type { SystemEvent } from "./system-event.ts";
import { toolMessage } from "./tool-message.ts";
import { runAgentTurn, type TurnEvent } from "./turn.ts";

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

export type ChatStreamOptions<Id extends string = string> = ReplSource<Id> & {
	config?: AgentConfig;
	signal?: AbortSignal;
	identity?: { distinctId?: string; sessionId?: string };
	onTurn?: (
		messages: WireMessage[],
		revised: ReadonlyMap<number, WireMessage>,
		failure: string | undefined,
	) => Promise<void> | void;
	steer?: { inbox: SteerInbox; key: string };
	quiet?: boolean;
	runsForms?: boolean;
};

function steerLine(steer: ChatStreamOptions["steer"]) {
	if (steer === undefined)
		return {
			open: async () => {},
			take: async (): Promise<Steer[]> => [],
			close: async () => {},
		};
	const { inbox, key } = steer;
	return {
		open: () => inbox.open(key),
		take: () => inbox.take(key),
		close: () => inbox.close(key),
	};
}

type Of<T extends TurnEvent["type"]> = Extract<TurnEvent, { type: T }>;

class TurnWire {
	readonly wire: WireMessage[];
	readonly carried: number;
	readonly revised = new Map<number, WireMessage>();
	steps = 0;
	failure: string | undefined;
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
				this.wire.push({ type: "human", content: event.content, id: event.id });
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
				if (this.lastMeta) this.lastMeta.steps = event.steps;
				this.snapshot();
				return true;
			case "capped":
				this.steps = event.steps;
				return true;
			case "silent":
				this.steps = event.steps;
				console.error(
					`[ai] the model returned an empty reply after ${event.steps} step(s)`,
				);
				return true;
			case "failed":
				console.error("[ai] chat stream failed:", event.error);
				this.failure = event.message;
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
				...(event.written ? { written: event.written } : {}),
				prose: event.prose,
				meta: this.lastMeta,
			},
		});
	}

	private result(event: Of<"result">): boolean {
		this.steps = event.step;
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
	onTurn: ChatStreamOptions["onTurn"],
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

export function streamChatResponse<Id extends string>(
	input: ChatInput,
	options: ChatStreamOptions<Id>,
): Response {
	const {
		threadId,
		config,
		identity,
		onTurn,
		signal,
		steer,
		quiet,
		runsForms,
	} = options;
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
			const steering = steerLine(steer);

			try {
				await steering.open();
				turn.snapshot();
				if (!quiet) {
					const repl = await replFrom(options);
					for await (const event of runAgentTurn(toTranscript(input), {
						repl,
						threadId,
						config,
						signal: abort.signal,
						identity,
						inbox: steering.take,
						runsForms,
						received: received(input),
					}))
						if (!turn.apply(event)) break;
				}
			} catch (error) {
				console.error("[ai] the turn could not run:", error);
				turn.failure = errorText(error);
				write(sse("error", { error: "AgentError", message: errorText(error) }));
			} finally {
				await steering
					.close()
					.catch((error) =>
						console.error("[ai] the steer inbox did not close:", error),
					);
				await record(onTurn, turn);
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

	return new Response(body, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
		},
	});
}
