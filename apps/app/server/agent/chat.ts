import { api } from "@repo/backend/api";
import { ENVELOPE_KEYS } from "@repo/shared/messages";
import { z } from "zod";
import { body } from "./body.ts";
import { serveTurns } from "./chat-turns.ts";
import { convexAs } from "./convex.ts";
import { convexId } from "./ids.ts";
import { repls } from "./repls.ts";
import { type Authed, authed } from "./session.ts";
import { post, withdraw as withdrawPost } from "./threads.ts";

const ENVELOPE: ReadonlySet<string> = new Set(ENVELOPE_KEYS);

const carried = z
	.record(z.string(), z.json())
	.refine(
		(annotations) => !Object.keys(annotations).some((key) => ENVELOPE.has(key)),
		{
			message: "a message envelope field cannot be sent with a message",
		},
	);

export const chatRequestSchema = z.object({
	input: z.object({
		chatId: convexId<"chats">(),
		message: z.string(),
		annotations: carried.optional(),
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

function identityOf(request: Request) {
	return {
		distinctId: request.headers.get("x-distinct-id") ?? undefined,
		sessionId: request.headers.get("x-posthog-session-id") ?? undefined,
	};
}

export const turn = {
	middleware: [...authed, body(chatRequestSchema)] as const,
	handler: async ({
		request,
		context,
	}: Authed<z.infer<typeof chatRequestSchema>>): Promise<Response> => {
		const { chatId, message, annotations } = context.body.input;
		const posted = await post(
			{ session: context.session, identity: identityOf(request) },
			chatId,
			{
				kind: "user",
				id: crypto.randomUUID(),
				text: message,
				forms: true,
				...(annotations === undefined ? {} : { annotations }),
			},
			{ watch: true, signal: request.signal },
		);
		return (await posted.opened) ?? new Response(null, { status: 204 });
	},
};

serveTurns({
	async wake({ session, chatId, notice }) {
		await post({ session }, chatId, {
			kind: "event",
			id: crypto.randomUUID(),
			source: notice.source,
			text: notice.text,
		});
	},
	async reply(session, chatId, message, { maxSteps, signal }) {
		const posted = await post(
			{ session },
			chatId,
			{ kind: "user", id: crypto.randomUUID(), text: message, forms: false },
			{ maxSteps, signal },
		);
		return posted.ended;
	},
	source: (chatId) => ({ repls, threadId: chatId }),
});

export const steer = {
	middleware: [...authed, body(steerRequestSchema)] as const,
	handler: async ({
		request,
		context,
	}: Authed<z.infer<typeof steerRequestSchema>>): Promise<Response> => {
		const { chatId, id, message } = context.body;
		await convexAs(context.session).query(api.chats.get, { chatId });
		await post(
			{ session: context.session, identity: identityOf(request) },
			chatId,
			{ kind: "user", id, text: message, forms: true },
		);
		return Response.json({ accepted: true }, { status: 202 });
	},
};

export const withdraw = {
	middleware: [...authed, body(withdrawRequestSchema)] as const,
	handler: async ({
		context,
	}: Authed<z.infer<typeof withdrawRequestSchema>>): Promise<Response> => {
		const { chatId, id } = context.body;
		await convexAs(context.session).query(api.chats.get, { chatId });
		const withdrawn = await withdrawPost(chatId, id);
		return Response.json({ withdrawn }, { status: withdrawn ? 200 : 409 });
	},
};
