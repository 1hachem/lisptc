import {
	evalUserCode,
	MemorySteerInbox,
	type SteerInbox,
	streamChatResponse,
	systemEventMessage,
} from "@repo/ai";
import { api } from "@repo/backend/api";
import { Hono } from "hono";
import { z } from "zod";
import { convexAs } from "./convex.ts";
import { events } from "./events.ts";
import { type StoredMessage, toInput, toStored } from "./history.ts";
import { convexId } from "./ids.ts";
import { chatModel } from "./model.ts";
import { repls } from "./repls.ts";
import { session } from "./session.ts";

export const chatRequestSchema = z.object({
	input: z.union([
		z.object({
			chatId: convexId<"chats">(),
			message: z.string(),
		}),
		z.object({
			chatId: convexId<"chats">(),
			event: z.object({ token: z.string().min(1) }),
		}),
	]),
});

type TurnInput = z.infer<typeof chatRequestSchema>["input"];

async function openingMessage(
	input: TurnInput,
	subject: string,
): Promise<StoredMessage | undefined> {
	if ("message" in input) return { type: "human", content: input.message };
	const event = await events.redeem(input.event.token, {
		subject,
		chatId: input.chatId,
	});
	if (event === undefined) return undefined;
	return toStored([systemEventMessage(event, crypto.randomUUID())])[0];
}

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
	const { input } = parsed.data;
	const { chatId } = input;
	const opening = await openingMessage(input, c.get("session").subject);
	if (opening === undefined) {
		console.warn(`rejected chat event chat=${chatId}: unknown token`);
		return c.json({ error: "no system event is waiting for this token" }, 403);
	}
	const convex = convexAs(c.get("session"));

	const { workspaceId } = await convex.query(api.chats.get, { chatId });
	const { provider, model } = chatModel(
		(await convex.query(api.workspaces.get, { workspaceId })).model,
	);
	await convex.mutation(api.messages.append, {
		chatId,
		messages: [opening],
	});
	const history = await convex.query(api.messages.transcript, { chatId });

	console.log(
		`chat chat=${chatId} messages=${history.length} ${provider}/${model}`,
	);
	return streamChatResponse(
		{ messages: toInput(history) },
		{
			repls,
			threadId: chatId,
			config: { provider, model },
			signal: c.req.raw.signal,
			steer: {
				inbox: steers,
				key: steerKey(c.get("session").subject, chatId),
			},
			identity: {
				distinctId: c.req.header("x-distinct-id"),
				sessionId: c.req.header("x-posthog-session-id"),
			},
			onTurn: async (produced, revised) => {
				for (const [at, message] of revised) {
					const stored = history[at];
					if (
						stored?.wireId === undefined ||
						message.additional_kwargs === undefined
					)
						continue;
					await convex.mutation(api.messages.annotate, {
						chatId,
						id: stored.wireId,
						kwargs: message.additional_kwargs,
					});
				}
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
