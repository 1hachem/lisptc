//TODO: check if langchain has builtin functions to support these helpers
// for sure they have a funtion for use-stream since its a native
import { type AgentConfig, type AgentMessage, streamAgent } from "./agent.ts";

/** A message as it arrives from the client (LangChain message-like dict). */
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

/** Frame one LangGraph stream event as an SSE record. */
function sse(event: string, data: unknown): Uint8Array {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) =>
				typeof part === "string"
					? part
					: part && typeof part === "object" && "text" in part
						? String((part as { text: unknown }).text)
						: "",
			)
			.join("");
	}
	return "";
}

function agentRole(type: string | undefined): AgentMessage["role"] {
	if (type === "ai" || type === "assistant") return "assistant";
	if (type === "system") return "system";
	return "user";
}

/** LangGraph uses `human`/`ai`/`system` as the wire message types. */
function wireType(type: string | undefined): "human" | "ai" | "system" {
	if (type === "ai" || type === "assistant") return "ai";
	if (type === "system") return "system";
	return "human";
}

export function toAgentMessages(input: ChatInput): AgentMessage[] {
	return (input.messages ?? []).map((m) => ({
		role: agentRole(m.type ?? m.role),
		content: contentToText(m.content),
	}));
}

/**
 * Bridge the LangChain agent to the LangGraph "messages-tuple" streaming
 * protocol that `useStream` (FetchStreamTransport) consumes:
 *   - a `values` event echoes the incoming turn so it renders immediately,
 *   - `messages` events carry AI token deltas (concatenated by id client-side),
 *   - a final `values` event publishes the authoritative message list.
 * Returns a standard SSE `Response` so any web server (Hono) can return it.
 */
export function streamChatResponse(
	input: ChatInput,
	config?: AgentConfig,
	signal?: AbortSignal,
): Response {
	const history = (input.messages ?? []).map((m, i) => ({
		type: wireType(m.type ?? m.role),
		content: contentToText(m.content),
		id: m.id ?? `msg-${i}`,
	}));
	const aiId = crypto.randomUUID();

	// The client tears the fetch down (and re-issues it) whenever dev tools open
	// or the tab reloads. Once that happens `controller.enqueue` throws, so every
	// write is guarded and the abort is propagated to the upstream model call —
	// otherwise the unhandled error would take the server process down.
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
			try {
				write(sse("values", { messages: history }));
				let full = "";
				let reasoning = "";
				// Reasoning rides in `additional_kwargs.reasoning_content`; the client's
				// MessageTupleManager concatenates additional_kwargs across chunks (via
				// AIMessageChunk.concat), so per-delta fragments reassemble into the full
				// thinking trace on the message.
				for await (const delta of streamAgent(toAgentMessages(input), config, {
					signal: abort.signal,
				})) {
					const chunk: Record<string, unknown> = { type: "ai", id: aiId };
					if (delta.reasoning) {
						reasoning += delta.reasoning;
						chunk.content = "";
						chunk.additional_kwargs = { reasoning_content: delta.reasoning };
					} else {
						full += delta.text ?? "";
						chunk.content = delta.text ?? "";
					}
					if (!write(sse("messages", [chunk, {}]))) break;
				}
				const finalAi: Record<string, unknown> = {
					type: "ai",
					content: full,
					id: aiId,
				};
				if (reasoning)
					finalAi.additional_kwargs = { reasoning_content: reasoning };
				write(sse("values", { messages: [...history, finalAi] }));
			} catch (err) {
				if (!abort.signal.aborted) {
					write(
						sse("error", {
							error: "AgentError",
							message: err instanceof Error ? err.message : String(err),
						}),
					);
				}
			} finally {
				closed = true;
				try {
					controller.close();
				} catch {
					// already closed by the client disconnect — nothing to do
				}
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
