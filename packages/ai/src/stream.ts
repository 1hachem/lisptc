import { contentToText } from "@repo/shared/messages";
import type { AgentConfig } from "./agent.ts";
import type { Steer, SteerInbox } from "./inbox.ts";
import { joinRiding, replResultContent, type TranscriptEntry } from "./repl.ts";
import { type ReplSource, replFrom } from "./repl-store.ts";
import type { SystemEvent } from "./system-event.ts";
import { runAgentTurn } from "./turn.ts";

export interface ChatMessageInput {
	id?: string;
	type?: string;
	role?: string;
	content?: unknown;
	additional_kwargs?: Record<string, unknown>;
}

export interface ChatInput {
	messages?: ChatMessageInput[];
}

export interface WireMessage {
	type: string;
	content: string;
	id: string;
	additional_kwargs?: Record<string, unknown>;
}

const encoder = new TextEncoder();

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
	const meta = { ...((kwargs.meta as Record<string, unknown>) ?? {}) };
	mergeInto(meta, annotations);
	return { ...message, additional_kwargs: { ...kwargs, meta } };
}

function riding(message: { additional_kwargs?: Record<string, unknown> }) {
	const standing = message.additional_kwargs?.riding;
	return typeof standing === "string" ? standing : undefined;
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

const SOURCE_KEY = "source";

export function systemEventMessage(
	event: SystemEvent,
	id: string,
): WireMessage {
	return {
		type: "system",
		content: event.text,
		id,
		additional_kwargs: { [SOURCE_KEY]: event.source },
	};
}

function eventSource(message: ChatMessageInput): string {
	const source = message.additional_kwargs?.[SOURCE_KEY];
	return typeof source === "string" ? source : "system";
}

function toTranscript(input: ChatInput): TranscriptEntry[] {
	return (input.messages ?? []).map((m) => {
		const content = contentToText(m.content);
		const role = agentRole(m.type ?? m.role);
		if (role === "system")
			return { role: "user", content, event: { source: eventSource(m) } };
		const rode = riding(m);
		return { role, content, ...(rode === undefined ? {} : { riding: rode }) };
	});
}

export type ChatStreamOptions<Id extends string = string> = ReplSource<Id> & {
	config?: AgentConfig;
	signal?: AbortSignal;
	identity?: { distinctId?: string; sessionId?: string };
	onTurn?: (
		messages: WireMessage[],
		revised: ReadonlyMap<number, WireMessage>,
	) => Promise<void> | void;
	steer?: { inbox: SteerInbox; key: string };
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

export function streamChatResponse<Id extends string>(
	input: ChatInput,
	options: ChatStreamOptions<Id>,
): Response {
	const { threadId, config, identity, onTurn, signal, steer } = options;
	const abort = new AbortController();
	if (signal)
		signal.addEventListener("abort", () => abort.abort(), { once: true });

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

			const wire: WireMessage[] = (input.messages ?? []).map((m, i) => ({
				type: wireType(m.type ?? m.role),
				content: contentToText(m.content),
				id: m.id ?? `msg-${i}`,
				...(m.additional_kwargs
					? { additional_kwargs: m.additional_kwargs }
					: undefined),
			}));

			const carried = wire.length;
			let steps = 0;
			let lastMeta: Record<string, unknown> | undefined;
			const revised = new Map<number, WireMessage>();
			const steering = steerLine(steer);

			try {
				await steering.open();
				write(sse("values", { messages: wire }));

				const repl = await replFrom(options);

				for await (const event of runAgentTurn(toTranscript(input), {
					repl,
					threadId,
					config,
					signal: abort.signal,
					identity,
					inbox: steering.take,
				})) {
					if (event.type === "delta") {
						const chunk: Record<string, unknown> = {
							type: "ai",
							id: event.stepId,
						};
						if (event.reasoning !== undefined) {
							chunk.content = "";
							chunk.additional_kwargs = {
								reasoning_content: event.reasoning,
							};
						} else {
							chunk.content = event.text ?? "";
						}
						if (!write(sse("messages", [chunk, {}]))) break;
					} else if (event.type === "steered") {
						wire.push({ type: "human", content: event.content, id: event.id });
						if (!write(sse("values", { messages: wire }))) break;
					} else if (event.type === "collected") {
						const at = lastHuman(wire);
						if (at === -1) continue;
						wire[at] = annotate(wire[at], event.annotations);
						if (at < carried) revised.set(at, wire[at]);
						if (!write(sse("values", { messages: wire }))) break;
					} else if (event.type === "rode") {
						const at = lastHuman(wire);
						if (at === -1) continue;
						const carrier = wire[at];
						wire[at] = {
							...carrier,
							additional_kwargs: {
								...carrier.additional_kwargs,
								riding: joinRiding(riding(carrier), event.text),
							},
						};
						if (at < carried) revised.set(at, wire[at]);
					} else if (event.type === "assistant") {
						lastMeta = { ...event.meta };
						wire.push({
							type: "ai",
							content: event.code,
							id: event.stepId,
							additional_kwargs: {
								...(event.reasoning
									? { reasoning_content: event.reasoning }
									: {}),
								prose: event.prose,
								meta: lastMeta,
							},
						});
					} else if (event.type === "result") {
						steps = event.step;
						if (lastMeta) mergeInto(lastMeta, event.annotations.step);
						const extras: Record<string, unknown> = {
							...event.annotations.output,
						};
						if (event.display !== event.output) extras.display = event.display;
						if (event.failed) extras.failed = true;
						if (event.riding !== undefined) extras.riding = event.riding;
						wire.push({
							type: "tool",
							content: replResultContent(event.output, event.error),
							id: crypto.randomUUID(),
							...(Object.keys(extras).length > 0
								? { additional_kwargs: extras }
								: undefined),
						});
						if (!write(sse("values", { messages: wire }))) break;
					} else if (event.type === "halt") {
						steps = event.steps;
						if (lastMeta) lastMeta.steps = event.steps;
						write(sse("values", { messages: wire }));
					} else if (event.type === "capped") {
						steps = event.steps;
					} else if (event.type === "silent") {
						steps = event.steps;
						console.error(
							`[ai] the model returned an empty reply after ${event.steps} step(s)`,
						);
					} else {
						console.error("[ai] chat stream failed:", event.error);
						write(
							sse("error", {
								error: "AgentError",
								message: event.message,
							}),
						);
					}
				}
			} catch (error) {
				console.error("[ai] the turn could not run:", error);
				write(
					sse("error", {
						error: "AgentError",
						message: error instanceof Error ? error.message : String(error),
					}),
				);
			} finally {
				await steering
					.close()
					.catch((error) =>
						console.error("[ai] the steer inbox did not close:", error),
					);
				if (onTurn) {
					try {
						await onTurn(wire.slice(carried), revised);
					} catch (error) {
						console.error("[ai] the turn was not recorded:", error);
					}
				}
				console.log(
					`[ai] chat stream closed after ${steps} step(s)${abort.signal.aborted ? " (client disconnected)" : ""}`,
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
