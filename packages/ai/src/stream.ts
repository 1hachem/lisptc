import { contentToText } from "@repo/shared/messages";
import type { AgentConfig } from "./agent.ts";
import { replResultContent, type TranscriptEntry } from "./repl.ts";
import { runAgentTurn } from "./turn.ts";

export interface ChatMessageInput {
	id?: string;
	type?: string;
	role?: string;
	content?: unknown;
}

export interface ChatInput {
	messages?: ChatMessageInput[];
}

const encoder = new TextEncoder();

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

function toTranscript(input: ChatInput): TranscriptEntry[] {
	return (input.messages ?? []).map((m) => ({
		role: agentRole(m.type ?? m.role),
		content: contentToText(m.content),
	}));
}

export function streamChatResponse(
	input: ChatInput,
	config?: AgentConfig,
	signal?: AbortSignal,
	threadId?: string,
	identity?: { distinctId?: string; sessionId?: string },
): Response {
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

			const wire: Record<string, unknown>[] = (input.messages ?? []).map(
				(m, i) => ({
					type: wireType(m.type ?? m.role),
					content: contentToText(m.content),
					id: m.id ?? `msg-${i}`,
				}),
			);

			let steps = 0;
			let lastMeta: Record<string, unknown> | undefined;

			try {
				write(sse("values", { messages: wire }));

				for await (const event of runAgentTurn(toTranscript(input), {
					threadId,
					config,
					signal: abort.signal,
					identity,
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
								meta: lastMeta,
							},
						});
					} else if (event.type === "result") {
						steps = event.step;
						wire.push({
							type: "tool",
							content: replResultContent(event.output, event.error),
							id: crypto.randomUUID(),
							...(event.display !== event.output
								? { additional_kwargs: { display: event.display } }
								: undefined),
						});
						if (!write(sse("values", { messages: wire }))) break;
					} else if (event.type === "halt") {
						steps = event.steps;
						if (lastMeta) lastMeta.steps = event.steps;
						write(sse("values", { messages: wire }));
					} else if (event.type === "capped") {
						steps = event.steps;
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
			} finally {
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
