import {
	evalUserCode,
	MemorySteerInbox,
	type SteerInbox,
	streamChatResponse,
} from "@repo/ai";
import { api } from "@repo/backend/api";
import { Hono } from "hono";
import { z } from "zod";
import { convexAs } from "./convex.ts";
import { toInput, toStored } from "./history.ts";
import { convexId } from "./ids.ts";
import { CHAT_MODEL, CHAT_PROVIDER } from "./model.ts";
import { repls } from "./repls.ts";
import { session } from "./session.ts";

export const chatRequestSchema = z.object({
	input: z.object({
		chatId: convexId<"chats">(),
		message: z.string(),
	}),
});

export const steerRequestSchema = z.object({
	chatId: convexId<"chats">(),
	id: z.string().min(1),
	message: z.string().trim().min(1),
});

const withdrawRequestSchema = steerRequestSchema.pick({
	chatId: true,
	id: true,
});

const steers: SteerInbox = new MemorySteerInbox();

const steerKey = (subject: string, chatId: string): string =>
	`${subject}:${chatId}`;

const evalRequestSchema = z.object({
	chatId: convexId<"chats">(),
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

	await convex.mutation(api.messages.append, {
		chatId,
		messages: [{ type: "human", content: message }],
	});
	const history = await convex.query(api.messages.transcript, { chatId });

	console.log(
		`chat chat=${chatId} messages=${history.length} ${CHAT_PROVIDER}/${CHAT_MODEL}`,
	);
	return streamChatResponse(
		{ messages: toInput(history) },
		{
			repls,
			threadId: chatId,
			config: { provider: CHAT_PROVIDER, model: CHAT_MODEL },
			signal: c.req.raw.signal,
			steer: {
				inbox: steers,
				key: steerKey(c.get("session").subject, chatId),
			},
			identity: {
				distinctId: c.req.header("x-distinct-id"),
				sessionId: c.req.header("x-posthog-session-id"),
			},
			onTurn: async (produced) => {
				const messages = toStored(produced);
				if (messages.length === 0) return;
				await convex.mutation(api.messages.append, { chatId, messages });
			},
		},
	);
});

chat.post("/steer", async (c) => {
	const parsed = steerRequestSchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!parsed.success) {
		console.warn("rejected steer request:", z.treeifyError(parsed.error));
		return c.json({ error: z.treeifyError(parsed.error) }, 400);
	}
	const { chatId, id, message } = parsed.data;
	const accepted = await steers.post(
		steerKey(c.get("session").subject, chatId),
		{
			id,
			content: message,
		},
	);
	return c.json({ accepted }, accepted ? 202 : 409);
});

chat.delete("/steer", async (c) => {
	const parsed = withdrawRequestSchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!parsed.success) {
		console.warn("rejected withdraw request:", z.treeifyError(parsed.error));
		return c.json({ error: z.treeifyError(parsed.error) }, 400);
	}
	const { chatId, id } = parsed.data;
	const withdrawn = await steers.withdraw(
		steerKey(c.get("session").subject, chatId),
		id,
	);
	return c.json({ withdrawn }, withdrawn ? 200 : 409);
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

	await convex.mutation(api.messages.append, {
		chatId,
		messages: [{ id: crypto.randomUUID(), type: "human", content: code }],
	});
	console.log(`eval chat=${chatId} chars=${code.length}`);
	const message = await evalUserCode(code, { repls, threadId: chatId });
	await convex.mutation(api.messages.append, {
		chatId,
		messages: toStored([{ ...message }]),
	});
	return c.json({ message });
});
