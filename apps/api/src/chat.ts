import {
	type AgentReplOptions,
	evalUserCode,
	peekThreadRepl,
	streamChatResponse,
} from "@repo/ai";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { ConvexMemoryStore } from "@repo/backend/memory-store";
import { ConvexOAuthStore } from "@repo/backend/oauth-store";
import { ConvexSecretsStore } from "@repo/backend/secrets-store";
import type { OAuthRecord } from "@repo/mcp/ports";
import { Hono } from "hono";
import { z } from "zod";
import { convexAs } from "./convex.ts";
import { convexId } from "./ids.ts";
import { CHAT_MODEL, CHAT_PROVIDER } from "./model.ts";
import { currentSession, session } from "./session.ts";

export const chatRequestSchema = z.object({
	input: z.object({
		chatId: convexId<"chats">(),
		message: z.string(),
	}),
});

const evalRequestSchema = z.object({
	chatId: convexId<"chats">(),
	code: z.string(),
});

export const chat = new Hono();

chat.use(session);

async function replOptionsFor(chatId: Id<"chats">): Promise<AgentReplOptions> {
	const alreadyBuilt = peekThreadRepl(chatId) !== undefined;
	if (alreadyBuilt) return {};
	const { workspaceId } = await convexAs(currentSession()).query(
		api.chats.get,
		{ chatId },
	);
	const connect = () => convexAs(currentSession());
	return {
		scope: workspaceId,
		memory: new ConvexMemoryStore(workspaceId, connect),
		secrets: await ConvexSecretsStore.open(workspaceId, connect),
		oauth: new ConvexOAuthStore<OAuthRecord>(workspaceId, connect),
	};
}

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
	const replOptions = await replOptionsFor(chatId);

	console.log(
		`chat chat=${chatId} messages=${history.length} ${CHAT_PROVIDER}/${CHAT_MODEL}`,
	);
	return streamChatResponse(
		{ messages: history },
		{ provider: CHAT_PROVIDER, model: CHAT_MODEL },
		c.req.raw.signal,
		chatId,
		{
			distinctId: c.req.header("x-distinct-id"),
			sessionId: c.req.header("x-posthog-session-id"),
		},
		async (produced) => {
			if (produced.length === 0) return;
			await convex.mutation(api.messages.append, {
				chatId,
				messages: produced.map(({ id: _id, ...message }) => message),
			});
		},
		replOptions,
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

	await convex.mutation(api.messages.append, {
		chatId,
		messages: [{ type: "human", content: code }],
	});
	console.log(`eval chat=${chatId} chars=${code.length}`);
	const { id: _id, ...message } = await evalUserCode(
		code,
		chatId,
		await replOptionsFor(chatId),
	);
	await convex.mutation(api.messages.append, { chatId, messages: [message] });
	return c.json({ message });
});
