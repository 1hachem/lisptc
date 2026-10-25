import { api } from "@repo/backend/api";
import { ENVELOPE_KEYS } from "@repo/shared/messages";
import { z } from "zod";
import { body, params } from "./body.ts";
import { convexAs } from "./convex.ts";
import { convexId } from "./ids.ts";
import { type Authed, authed } from "./session.ts";
import { post, stopThread, watchThread, withdrawPost } from "./threads.ts";

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
		id: z.string().min(1).optional(),
		message: z.string(),
		annotations: carried.optional(),
	}),
});

export const steerRequestSchema = z.object({
	chatId: convexId<"chats">(),
	id: z.string().min(1),
	message: z.string().trim().min(1),
});

export const chatOnlySchema = z.object({ chatId: convexId<"chats">() });

export const stopRequestSchema = chatOnlySchema.extend({
	scope: z.enum(["thread", "tree"]).default("thread"),
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
		const id = context.body.input.id ?? crypto.randomUUID();
		await convexAs(context.session).query(api.chats.get, { chatId });
		await post(
			chatId,
			{
				kind: "user",
				id,
				text: message,
				forms: true,
				...(annotations === undefined ? {} : { annotations }),
			},
			undefined,
			identityOf(request),
		);
		return Response.json({ accepted: true, id }, { status: 202 });
	},
};

export const watch = {
	middleware: [...authed, params(chatOnlySchema)] as const,
	handler: async ({
		request,
		context,
	}: Authed<z.infer<typeof chatOnlySchema>>): Promise<Response> => {
		const { chatId } = context.body;
		await convexAs(context.session).query(api.chats.get, { chatId });
		return watchThread(chatId, request.signal);
	},
};

export const stop = {
	middleware: [...authed, body(stopRequestSchema)] as const,
	handler: async ({
		context,
	}: Authed<z.infer<typeof stopRequestSchema>>): Promise<Response> => {
		const { chatId, scope } = context.body;
		await convexAs(context.session).query(api.chats.get, { chatId });
		const stopped = await stopThread(chatId, scope);
		return Response.json({ stopped }, { status: stopped ? 200 : 409 });
	},
};

export const steer = {
	middleware: [...authed, body(steerRequestSchema)] as const,
	handler: async ({
		request,
		context,
	}: Authed<z.infer<typeof steerRequestSchema>>): Promise<Response> => {
		const { chatId, id, message } = context.body;
		await convexAs(context.session).query(api.chats.get, { chatId });
		await post(
			chatId,
			{ kind: "user", id, text: message, forms: true },
			undefined,
			identityOf(request),
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
