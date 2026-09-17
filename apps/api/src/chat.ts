import { evalUserCode, streamChatResponse } from "@repo/ai";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { Hono } from "hono";
import { z } from "zod";
import { convexAs } from "./convex.ts";
import { toInput, toStored } from "./history.ts";
import { CHAT_MODEL, CHAT_PROVIDER } from "./model.ts";
import { session } from "./session.ts";

export const chatRequestSchema = z.object({
	input: z.object({
		chatId: z.string(),
		message: z.string(),
	}),
});

const evalRequestSchema = z.object({
	chatId: z.string(),
	code: z.string(),
});

export const chat = new Hono();

chat.use(session);

chat.post("/", async (c) => {
	const parsed = chatRequestSchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!parsed.success) {
		console.warn("rejected chat request:", z.treeifyError(parsed.error));
		return c.json({ error: z.treeifyError(parsed.error) }, 400);
	}
	const { chatId, message } = parsed.data.input;
	const convex = convexAs(c.get("session"));
	const id = chatId as Id<"chats">;

	await convex.mutation(api.messages.append, {
		chatId: id,
		messages: [{ type: "human", content: message }],
	});
	const history = await convex.query(api.messages.transcript, { chatId: id });

	console.log(
		`chat chat=${chatId} messages=${history.length} ${CHAT_PROVIDER}/${CHAT_MODEL}`,
	);
	return streamChatResponse(
		{ messages: toInput(history) },
		{ provider: CHAT_PROVIDER, model: CHAT_MODEL },
		c.req.raw.signal,
		chatId,
		{
			distinctId: c.req.header("x-distinct-id"),
			sessionId: c.req.header("x-posthog-session-id"),
		},
		async (produced) => {
			const messages = toStored(produced);
			if (messages.length === 0) return;
			await convex.mutation(api.messages.append, { chatId: id, messages });
		},
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
	const { chatId, code } = parsed.data;
	const convex = convexAs(c.get("session"));
	const id = chatId as Id<"chats">;

	await convex.mutation(api.messages.append, {
		chatId: id,
		messages: [{ type: "human", content: code }],
	});
	console.log(`eval chat=${chatId} chars=${code.length}`);
	const message = await evalUserCode(code, chatId);
	await convex.mutation(api.messages.append, {
		chatId: id,
		messages: toStored([{ ...message }]),
	});
	return c.json({ message });
});
