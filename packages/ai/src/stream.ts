//TODO: check if langchain has builtin functions to support these helpers
// for sure they have a funtion for use-stream since its a native
import {
	type AgentConfig,
	type AgentMessage,
	streamAgent,
	type TokenUsage,
} from "./agent.ts";
import { MAX_STEPS } from "./prompts/lisp.ts";
import {
	evalCode,
	proseFeedbackContent,
	replResultContent,
	snapshotConversation,
	stripFences,
	type TranscriptEntry,
	toLlmMessages,
} from "./repl.ts";
import { getThreadRepl } from "./repl-store.ts";
import {
	captureReplEval,
	captureTurn,
	type TraceContext,
} from "./telemetry.ts";

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
 * repeating until the model answers in prose that runs nothing (see `AgentRepl`)
 * or `MAX_STEPS` is reached. That final prose turn is the answer to the user, so it
 * is streamed like any other assistant turn but produces no REPL result. Each step
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
	identity?: { distinctId?: string; sessionId?: string },
): Response {
	// The client tears the fetch down (and re-issues it) whenever dev tools open
	// or the tab reloads. Once that happens `controller.enqueue` throws, so every
	// write is guarded and the abort is propagated to the upstream model call —
	// otherwise the unhandled error would take the server process down.
	const abort = new AbortController();
	if (signal)
		signal.addEventListener("abort", () => abort.abort(), { once: true });

	// A turn always gets a trace id, even without a chat identity: an ephemeral
	// run is still worth measuring, it just groups only with itself.
	const trace: TraceContext = {
		threadId: threadId ?? crypto.randomUUID(),
		turnId: crypto.randomUUID(),
		distinctId: identity?.distinctId,
		sessionId: identity?.sessionId,
		provider: config?.provider,
		model: config?.model,
	};
	const tracedConfig: AgentConfig = { ...config, trace };
	const startedAt = Date.now();
	const prompt = contentToText(
		(input.messages ?? [])
			.filter((m) => wireType(m.type ?? m.role) === "human")
			.at(-1)?.content,
	);

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
			// What the turn is judged on: the prose the user actually reads, and
			// whether the loop stopped on its own instead of hitting MAX_STEPS.
			let answer = "";
			let halted = false;
			let failure: string | undefined;
			try {
				write(sse("values", { messages: wire }));

				const repl = getThreadRepl(threadId);
				const transcript = toTranscript(input);

				// A previous turn ended on an answer the REPL read as prose. Its
				// notes were withheld then (see `AgentRepl.eval`) and ride along
				// with this user message, so the model corrects itself without
				// having been given a turn to say so. Deliberately not pushed to
				// `wire`: it is a note to the model, not a message to the user,
				// and it should not come back on the next replayed transcript.
				const withheld = repl.takeProseFeedback();
				if (withheld)
					transcript.push({
						role: "tool",
						content: proseFeedbackContent(withheld),
					});

				while (!abort.signal.aborted) {
					// Refresh the read-only conversation globals so each step sees the
					// current transcript, including prior REPL results.
					repl.setConversationVars(snapshotConversation(transcript));

					const aiId = crypto.randomUUID();
					const stepStartedAt = Date.now();
					let full = "";
					let reasoning = "";
					let usage: TokenUsage | undefined;
					let disconnected = false;
					// Reasoning rides in `additional_kwargs.reasoning_content`; the client's
					// MessageTupleManager concatenates additional_kwargs across chunks (via
					// AIMessageChunk.concat), so per-delta fragments reassemble into the full
					// thinking trace on the message.
					for await (const delta of streamAgent(
						toLlmMessages(transcript),
						tracedConfig,
						{ signal: abort.signal },
					)) {
						// The accounting the backend appends once the completion is
						// done: nothing to stream, and it supersedes any earlier count.
						if (delta.usage) {
							usage = delta.usage;
							continue;
						}
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

					// What this one model call cost. It rides along for the UI to show
					// under the message and, like `reasoning_content`, never reaches the
					// model — whose context is rebuilt from `content` alone.
					//
					// Deliberately per-call and never added up across the loop: a step's
					// input is the whole conversation as it stood for that call, so each
					// step's count already contains the ones before it.
					const meta: Record<string, unknown> = {
						at: new Date().toISOString(),
						durationMs: Date.now() - stepStartedAt,
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
					const finalAi: Record<string, unknown> = {
						type: "ai",
						content: code,
						id: aiId,
						additional_kwargs: {
							...(reasoning ? { reasoning_content: reasoning } : {}),
							meta,
						},
					};
					wire.push(finalAi);
					transcript.push({ role: "assistant", content: code });

					const evalStartedAt = Date.now();
					const { output, error } = evalCode(repl, code);
					steps += 1;
					// A form-less turn ran no code, so there is no result worth
					// showing the user (or feeding back) — it is the final answer.
					if (repl.takeFinished()) {
						answer = code;
						halted = true;
						// How many model calls it took to get here. The one count that is
						// genuinely the whole turn's rather than this call's, so it hangs
						// off the message the reader ends on.
						meta.steps = steps;
						write(sse("values", { messages: wire }));
						break;
					}
					captureReplEval(trace, {
						step: steps,
						source: code,
						output,
						error,
						latencyMs: Date.now() - evalStartedAt,
					});

					const resultContent = replResultContent(output, error);
					wire.push({
						type: "tool",
						content: resultContent,
						id: crypto.randomUUID(),
					});
					transcript.push({ role: "tool", content: resultContent });

					if (!write(sse("values", { messages: wire }))) break;
					if (steps >= MAX_STEPS) break;
				}
			} catch (err) {
				failure = err instanceof Error ? err.message : String(err);
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
				captureTurn(trace, {
					prompt,
					answer,
					steps,
					halted,
					latencyMs: Date.now() - startedAt,
					error: failure,
				});
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
