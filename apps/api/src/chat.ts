import { LISP_SYSTEM_PROMPT, streamChatResponse } from "@repo/ai";
import { Hono } from "hono";
import { z } from "zod";

// Validates the wire shape of `ChatInput` (a LangChain message-like list).
// `content` stays `unknown` to mirror the type — it can be a string or a rich
// content-part array, and the AI layer normalizes it downstream.
const chatMessageSchema = z.object({
	id: z.string().optional(),
	type: z.string().optional(),
	role: z.string().optional(),
	content: z.unknown().optional(),
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
		return c.json({ error: z.treeifyError(parsed.error) }, 400);
	}
	const { input, config } = parsed.data;
	return streamChatResponse(
		input ?? {},
		{ provider: "llamacpp", system: LISP_SYSTEM_PROMPT },
		c.req.raw.signal,
		config?.configurable?.thread_id,
	);
});
