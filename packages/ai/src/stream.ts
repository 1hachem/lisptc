//TODO: check if langchain has builtin functions to support these helpers
// for sure they have a funtion for use-stream since its a native
import { type AgentConfig, type AgentMessage, streamAgent } from "./agent.ts";
import { MAX_STEPS } from "./prompts/lisp.ts";
import {
	evalCode,
	replResultContent,
	snapshotConversation,
	stripFences,
	type TranscriptEntry,
	toLlmMessages,
} from "./repl.ts";
import { getThreadRepl } from "./repl-store.ts";

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

function agentRole(type: string | undefined): TranscriptEntry["role"] {
	if (type === "ai" || type === "assistant") return "assistant";
	if (type === "system") return "system";
	if (type === "tool") return "tool";
	return "user";
}

/** LangGraph uses `human`/`ai`/`system`/`tool` as the wire message types. */
function wireType(
	type: string | undefined,
): "human" | "ai" | "system" | "tool" {
	if (type === "ai" || type === "assistant") return "ai";
	if (type === "system") return "system";
	if (type === "tool") return "tool";
	return "human";
}

export function toAgentMessages(input: ChatInput): AgentMessage[] {
	return toLlmMessages(toTranscript(input));
}

// Build the running transcript from the client's replayed message list. A prior
// `tool` message (a REPL result echoed back on the previous turn) keeps its
// `tool` role so it stays out of `user-messages`.
function toTranscript(input: ChatInput): TranscriptEntry[] {
	return (input.messages ?? []).map((m) => ({
		role: agentRole(m.type ?? m.role),
		content: contentToText(m.content),
	}));
}

/**
 * Drive the REPL loop and bridge it to the LangGraph "messages-tuple" streaming
 * protocol that `useStream` (FetchStreamTransport) consumes. Each loop step:
 *   1. streams one grammar-constrained assistant turn (its text IS a Lisp
 *      program) as `messages` token deltas,
 *   2. evaluates that program against a persistent `AgentRepl`,
 *   3. emits the REPL result as a `tool` message and feeds it back as the next
 *      turn's input,
 * repeating until the model calls `(halt)` or `MAX_STEPS` is reached. Each step
 * publishes an authoritative `values` event so the client reconciles the full
 * message list. Returns a standard SSE `Response` any web server (Hono) returns.
 *
 * The `AgentRepl` persists per chat: it is looked up by `threadId` (see
 * `repl-store.ts`), so definitions and loaded MCP servers built up on earlier
 * turns are still there on the next request. The transcript the client replays
 * each turn only supplies the model's *textual* context — the interpreter STATE
 * lives in the reused REPL. With no `threadId` the REPL is ephemeral (one
 * request), matching the old stateless behavior.
 */
export function streamChatResponse(
	input: ChatInput,
	config?: AgentConfig,
	signal?: AbortSignal,
	threadId?: string,
): Response {
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

			// The authoritative message list, echoed to the client and grown as the
			// loop produces assistant + tool messages.
			const wire: Record<string, unknown>[] = (input.messages ?? []).map(
				(m, i) => ({
					type: wireType(m.type ?? m.role),
					content: contentToText(m.content),
					id: m.id ?? `msg-${i}`,
				}),
			);

			let steps = 0;
			try {
				write(sse("values", { messages: wire }));

				const repl = getThreadRepl(threadId);
				const transcript = toTranscript(input);

				while (!abort.signal.aborted) {
					// Refresh the read-only conversation globals so each step sees the
					// current transcript, including prior REPL results.
					repl.setConversationVars(snapshotConversation(transcript));

					const aiId = crypto.randomUUID();
					let full = "";
					let reasoning = "";
					let disconnected = false;
					// Reasoning rides in `additional_kwargs.reasoning_content`; the client's
					// MessageTupleManager concatenates additional_kwargs across chunks (via
					// AIMessageChunk.concat), so per-delta fragments reassemble into the full
					// thinking trace on the message.
					for await (const delta of streamAgent(
						toLlmMessages(transcript),
						config,
						{ signal: abort.signal },
					)) {
						const chunk: Record<string, unknown> = { type: "ai", id: aiId };
						if (delta.reasoning) {
							reasoning += delta.reasoning;
							chunk.content = "";
							chunk.additional_kwargs = { reasoning_content: delta.reasoning };
						} else {
							full += delta.text ?? "";
							chunk.content = delta.text ?? "";
						}
						if (!write(sse("messages", [chunk, {}]))) {
							disconnected = true;
							break;
						}
					}
					if (disconnected) break;

					const code = stripFences(full);
					if (code === "") break;

					const finalAi: Record<string, unknown> = {
						type: "ai",
						content: code,
						id: aiId,
					};
					if (reasoning)
						finalAi.additional_kwargs = { reasoning_content: reasoning };
					wire.push(finalAi);
					transcript.push({ role: "assistant", content: code });

					const { output, error } = evalCode(repl, code);
					steps += 1;
					const halted = repl.takeHalted();

					const resultContent = replResultContent(output, error);
					wire.push({
						type: "tool",
						content: resultContent,
						id: crypto.randomUUID(),
					});
					transcript.push({ role: "tool", content: resultContent });

					if (!write(sse("values", { messages: wire }))) break;
					if (halted || steps >= MAX_STEPS) break;
				}
			} catch (err) {
				if (!abort.signal.aborted) {
					// The response headers went out long ago, so this is the only place
					// a failed model call is ever reported: without the log it reaches
					// the browser as an SSE `error` event and the server says nothing.
					console.error("[ai] chat stream failed:", err);
					write(
						sse("error", {
							error: "AgentError",
							message: err instanceof Error ? err.message : String(err),
						}),
					);
				}
			} finally {
				// The SSE body outlives the request log line, so this is the only
				// record of how (and whether) a chat turn actually finished.
				console.log(
					`[ai] chat stream closed after ${steps} step(s)${abort.signal.aborted ? " (client disconnected)" : ""}`,
				);
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
