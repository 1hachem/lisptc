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

			const wire: Record<string, unknown>[] = (input.messages ?? []).map(
				(m, i) => ({
					type: wireType(m.type ?? m.role),
					content: contentToText(m.content),
					id: m.id ?? `msg-${i}`,
				}),
			);

			let steps = 0;
			let answer = "";
			let halted = false;
			let failure: string | undefined;
			try {
				write(sse("values", { messages: wire }));

				const repl = getThreadRepl(threadId);
				const transcript = toTranscript(input);

				const withheld = repl.takeProseFeedback();
				if (withheld)
					transcript.push({
						role: "tool",
						content: proseFeedbackContent(withheld),
					});

				while (!abort.signal.aborted) {
					repl.setConversationVars(snapshotConversation(transcript));

					const aiId = crypto.randomUUID();
					const stepStartedAt = Date.now();
					let full = "";
					let reasoning = "";
					let usage: TokenUsage | undefined;
					let disconnected = false;
					for await (const delta of streamAgent(
						toLlmMessages(transcript),
						tracedConfig,
						{ signal: abort.signal },
					)) {
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
					const { output, display, error } = await evalCode(repl, code);
					steps += 1;
					if (repl.takeFinished()) {
						answer = code;
						halted = true;
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
						...(display !== output
							? { additional_kwargs: { display } }
							: undefined),
					});
					transcript.push({ role: "tool", content: resultContent });

					if (!write(sse("values", { messages: wire }))) break;
					if (steps >= MAX_STEPS) break;
				}
			} catch (err) {
				failure = err instanceof Error ? err.message : String(err);
				if (!abort.signal.aborted) {
					console.error("[ai] chat stream failed:", err);
					write(
						sse("error", {
							error: "AgentError",
							message: err instanceof Error ? err.message : String(err),
						}),
					);
				}
			} finally {
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
