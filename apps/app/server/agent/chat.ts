import {
	evalUserCode,
	MemorySteerInbox,
	type SteerInbox,
	streamChatResponse,
	systemEventMessage,
} from "@repo/ai";
import { api } from "@repo/backend/api";
import { z } from "zod";
import { body } from "./body.ts";
import { convexAs } from "./convex.ts";
import { events } from "./events.ts";
import { type StoredMessage, toInput, toStored } from "./history.ts";
import { convexId } from "./ids.ts";
import { chatModel } from "./model.ts";
import { repls } from "./repls.ts";
import { type Authed, authed } from "./session.ts";

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
	if ("message" in input)
		return { id: crypto.randomUUID(), type: "human", content: input.message };
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

export const turn = {
	middleware: [...authed, body(chatRequestSchema)] as const,
	handler: async ({
		request,
		context,
	}: Authed<z.infer<typeof chatRequestSchema>>): Promise<Response> => {
		const { input } = context.body;
		const { chatId } = input;
		const opening = await openingMessage(input, context.session.subject);
		if (opening === undefined) {
			console.warn(`rejected chat event chat=${chatId}: unknown token`);
			return Response.json(
				{ error: "no system event is waiting for this token" },
				{ status: 403 },
			);
		}
		const convex = convexAs(context.session);

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
				signal: request.signal,
				steer: {
					inbox: steers,
					key: steerKey(context.session.subject, chatId),
				},
				identity: {
					distinctId: request.headers.get("x-distinct-id") ?? undefined,
					sessionId: request.headers.get("x-posthog-session-id") ?? undefined,
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
	},
};

export const steer = {
	middleware: [...authed, body(steerRequestSchema)] as const,
	handler: async ({
		context,
	}: Authed<z.infer<typeof steerRequestSchema>>): Promise<Response> => {
		const { chatId, id, message } = context.body;
		const accepted = await steers.post(
			steerKey(context.session.subject, chatId),
			{ id, content: message },
		);
		return Response.json({ accepted }, { status: accepted ? 202 : 409 });
	},
};

export const withdraw = {
	middleware: [...authed, body(withdrawRequestSchema)] as const,
	handler: async ({
		context,
	}: Authed<z.infer<typeof withdrawRequestSchema>>): Promise<Response> => {
		const { chatId, id } = context.body;
		const withdrawn = await steers.withdraw(
			steerKey(context.session.subject, chatId),
			id,
		);
		return Response.json({ withdrawn }, { status: withdrawn ? 200 : 409 });
	},
};

export const evaluate = {
	middleware: [...authed, body(evalRequestSchema)] as const,
	handler: async ({
		context,
	}: Authed<z.infer<typeof evalRequestSchema>>): Promise<Response> => {
		const { chatId, code } = context.body;
		const convex = convexAs(context.session);

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
		return Response.json({ message });
	},
};
