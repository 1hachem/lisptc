import { evalUserCode, streamChatResponse } from "@repo/ai";
import { Hono } from "hono";
import { z } from "zod";
import { CHAT_MODEL, CHAT_PROVIDER } from "./model.ts";

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

const evalRequestSchema = z.object({
	code: z.string(),
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
	return streamChatResponse(
		input ?? {},
		{ provider: CHAT_PROVIDER, model: CHAT_MODEL },
		c.req.raw.signal,
		threadId,
		{ distinctId, sessionId },
	);
});

chat.post("/eval", async (c) => {
	const parsed = evalRequestSchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!parsed.success) {
		console.warn("rejected eval request:", z.treeifyError(parsed.error));
		return c.json({ error: z.treeifyError(parsed.error) }, 400);
	}
	const { code, config } = parsed.data;
	const threadId = config?.configurable?.thread_id;
	console.log(`eval thread=${threadId ?? "-"} chars=${code.length}`);
	return c.json({ message: await evalUserCode(code, threadId) });
});
