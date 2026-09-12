import { ensureWarm, streamChatResponse } from "@repo/ai";
import { Hono } from "hono";
import { z } from "zod";
import { CHAT_MODEL, CHAT_PROVIDER, NEEDS_WARMUP } from "./model.ts";

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

export const chat = new Hono();

chat.post("/", async (c) => {
	const parsed = chatRequestSchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!parsed.success) {
		console.warn("rejected chat request:", z.treeifyError(parsed.error));
		return c.json({ error: z.treeifyError(parsed.error) }, 400);
	}
	const { input, config } = parsed.data;
	const distinctId = c.req.header("x-distinct-id");
	const sessionId = c.req.header("x-posthog-session-id");
	const threadId = config?.configurable?.thread_id;
	console.log(
		`chat thread=${threadId ?? "-"} messages=${input?.messages?.length ?? 0} ${CHAT_PROVIDER}/${CHAT_MODEL}`,
	);
	if (NEEDS_WARMUP) await ensureWarm();
	return streamChatResponse(
		input ?? {},
		{
			provider: CHAT_PROVIDER,
			model: CHAT_MODEL,
		},
		c.req.raw.signal,
		threadId,
		{ distinctId, sessionId },
	);
});
