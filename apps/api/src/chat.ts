import { ensureWarm, LISP_SYSTEM_PROMPT, streamChatResponse } from "@repo/ai";
import { Hono } from "hono";
import { z } from "zod";
import { CHAT_MODEL, CHAT_PROVIDER, NEEDS_WARMUP } from "./model.ts";

// Validates the wire shape of `ChatInput` (a LangChain message-like list).
// `content` stays `unknown` to mirror the type — it can be a string or a rich
// content-part array, and the AI layer normalizes it downstream.
const chatMessageSchema = z.object({
	id: z.string().optional(),
	type: z.string().optional(),
	role: z.string().optional(),
	content: z.unknown().optional(),
	// The UI-only extras the client replays (rendered widget, uncapped output,
	// reasoning). Opaque here: the AI layer echoes them back to the client and
	// never reads them into the model's context.
	additional_kwargs: z.record(z.string(), z.unknown()).optional(),
});

const chatRequestSchema = z.object({
	input: z
		.object({ messages: z.array(chatMessageSchema).optional() })
		.optional(),
	config: z
		.object({
			configurable: z.object({ thread_id: z.string().optional() }).optional(),
		})
		.optional(),
});

// The client's FetchStreamTransport posts `{ input, config, ... }`; the agent
// stream + LangGraph SSE framing all live in @repo/ai — this only routes.
export const chat = new Hono();

chat.post("/", async (c) => {
	// The client's FetchStreamTransport carries the chat identity in
	// `config.configurable.thread_id`; the REPL persists per thread so interpreter
	// state survives across a chat's turns.
	const parsed = chatRequestSchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!parsed.success) {
		console.warn("rejected chat request:", z.treeifyError(parsed.error));
		return c.json({ error: z.treeifyError(parsed.error) }, 400);
	}
	const { input, config } = parsed.data;
	// A browser-local id, so traces from one person group together in PostHog
	// without any account system. A header, not a body field, because the
	// client's transport owns the body shape.
	const distinctId = c.req.header("x-distinct-id");
	// Added by posthog-js `tracing_headers`. It is what joins this turn's trace
	// to the session replay of the person who typed it. Absent whenever browser
	// analytics is off, which the telemetry layer treats as simply unknown.
	const sessionId = c.req.header("x-posthog-session-id");
	const threadId = config?.configurable?.thread_id;
	console.log(
		`chat thread=${threadId ?? "-"} messages=${input?.messages?.length ?? 0} ${CHAT_PROVIDER}/${CHAT_MODEL}`,
	);
	// llama-server runs `--parallel 1`; going in before the system-prompt KV is
	// saved would both re-evaluate the prompt and poison the slot being saved.
	if (NEEDS_WARMUP) await ensureWarm();
	return streamChatResponse(
		input ?? {},
		{
			provider: CHAT_PROVIDER,
			model: CHAT_MODEL,
			system: LISP_SYSTEM_PROMPT,
		},
		c.req.raw.signal,
		threadId,
		{ distinctId, sessionId },
	);
});
