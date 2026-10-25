import {
	type ChatStreamOptions,
	evalUserMessage,
	MemorySteerInbox,
	renderSystemEvent,
	type SteerInbox,
	streamChatResponse,
	systemEventMessage,
	type TurnOutcome,
} from "@repo/ai";
import { api } from "@repo/backend/api";
import { TURN_DEADLINE_MS } from "@repo/backend/limits";
import { ENVELOPE_KEYS } from "@repo/shared/messages";
import { z } from "zod";
import { body } from "./body.ts";
import { serveTurns } from "./chat-turns.ts";
import { convexAs } from "./convex.ts";
import { events } from "./events.ts";
import { type StoredMessage, toInput, toStored } from "./history.ts";
import { convexId } from "./ids.ts";
import { chatModel } from "./model.ts";
import { repls } from "./repls.ts";
import { type Authed, authed, type Session } from "./session.ts";

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
	input: z.union([
		z.object({
			chatId: convexId<"chats">(),
			message: z.string(),
			annotations: carried.optional(),
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
		return {
			id: crypto.randomUUID(),
			type: "human",
			content: input.message,
			...(input.annotations ? { kwargs: input.annotations } : {}),
		};
	const event = await events.redeem(input.event.token, {
		subject,
		chatId: input.chatId,
	});
	if (event === undefined) return undefined;
	return toStored([systemEventMessage(event, crypto.randomUUID())])[0];
}

async function runUserForms(
	convex: ReturnType<typeof convexAs>,
	chatId: TurnInput["chatId"],
	message: string,
): Promise<{ quiet: boolean }> {
	const evaluated = await evalUserMessage(message, {
		repls,
		threadId: chatId,
	});
	if (evaluated === undefined) return { quiet: false };
	await convex.mutation(api.messages.append, {
		chatId,
		messages: toStored([evaluated.message]),
	});
	return { quiet: evaluated.quiet };
}

const preparing = new Map<string, Promise<void>>();

function oneTurnAtATime<T>(chatId: string, run: () => Promise<T>): Promise<T> {
	const turn = (preparing.get(chatId) ?? Promise.resolve()).then(run);
	const done = turn.then(
		() => undefined,
		() => undefined,
	);
	preparing.set(chatId, done);
	void done.then(() => {
		if (preparing.get(chatId) === done) preparing.delete(chatId);
	});
	return turn;
}

async function prepareTurn(
	convex: ReturnType<typeof convexAs>,
	input: TurnInput,
	opening: StoredMessage,
) {
	const { chatId } = input;
	const { workspaceId, agent } = await convex.query(api.chats.get, { chatId });
	const { provider, model } = chatModel(
		(await convex.query(api.workspaces.get, { workspaceId })).model,
	);
	const runsForms =
		(await convex.query(api.preferences.get, {})).input?.lisp !== false;
	const { history, quiet } = await oneTurnAtATime(chatId, async () => {
		await convex.mutation(api.messages.append, {
			chatId,
			messages: [opening],
		});
		const { quiet } =
			"message" in input && runsForms
				? await runUserForms(convex, chatId, input.message)
				: { quiet: false };
		return {
			history: await convex.query(api.messages.transcript, { chatId }),
			quiet,
		};
	});
	return {
		provider,
		model,
		history,
		quiet,
		runsForms,
		...(agent === undefined ? {} : { instructions: agent.prompt }),
	};
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

interface Identity {
	readonly distinctId?: string;
	readonly sessionId?: string;
}

type Ending = Pick<ChatStreamOptions, "maxSteps" | "onOutcome">;

async function runTurn(
	session: Session,
	input: TurnInput,
	opening: StoredMessage,
	signal: AbortSignal,
	identity: Identity,
	ending: Ending = {},
): Promise<Response> {
	const { chatId } = input;
	const convex = convexAs(session);
	const { provider, model, history, quiet, runsForms, instructions } =
		await convex
			.mutation(api.chats.start, { chatId })
			.then(() => prepareTurn(convex, input, opening))
			.catch(async (error: unknown) => {
				await convex
					.mutation(api.chats.settle, {
						chatId,
						failure: error instanceof Error ? error.message : String(error),
					})
					.catch((unsettled: unknown) =>
						console.error(`chat=${chatId} was not settled:`, unsettled),
					);
				throw error;
			});
	if (signal.aborted) {
		await convex.mutation(api.chats.settle, { chatId });
		return new Response(null, { status: 204 });
	}
	const deadline = AbortSignal.timeout(TURN_DEADLINE_MS);

	console.log(
		`chat chat=${chatId} messages=${history.length} ${provider}/${model}`,
	);
	return streamChatResponse(
		{ messages: toInput(history) },
		{
			repls,
			threadId: chatId,
			config: {
				provider,
				model,
				...(instructions === undefined ? {} : { instructions }),
			},
			signal: AbortSignal.any([signal, deadline]),
			...ending,
			quiet,
			runsForms,
			steer: {
				inbox: steers,
				key: steerKey(session.subject, chatId),
			},
			identity,
			onTurn: async (produced, revised, failure) => {
				try {
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
					if (messages.length > 0)
						await convex.mutation(api.messages.append, { chatId, messages });
				} finally {
					await convex.mutation(api.chats.settle, {
						chatId,
						failure:
							failure ??
							(deadline.aborted ? "the turn ran past its deadline" : undefined),
					});
				}
			},
		},
	);
}

export const turn = {
	middleware: [...authed, body(chatRequestSchema)] as const,
	handler: async ({
		request,
		context,
	}: Authed<z.infer<typeof chatRequestSchema>>): Promise<Response> => {
		const { input } = context.body;
		const opening = await openingMessage(input, context.session.subject);
		if (opening === undefined) {
			console.warn(`rejected chat event chat=${input.chatId}: unknown token`);
			return Response.json(
				{ error: "no system event is waiting for this token" },
				{ status: 403 },
			);
		}
		return runTurn(context.session, input, opening, request.signal, {
			distinctId: request.headers.get("x-distinct-id") ?? undefined,
			sessionId: request.headers.get("x-posthog-session-id") ?? undefined,
		});
	},
};

async function drained(response: Response): Promise<void> {
	await response.body?.pipeTo(new WritableStream());
}

serveTurns({
	async wake({ session, chatId, notice: event }) {
		const steered = await steers.post(steerKey(session.subject, chatId), {
			kind: "event",
			id: crypto.randomUUID(),
			content: renderSystemEvent(event),
		});
		if (steered) return;
		const opening = toStored([
			systemEventMessage(event, crypto.randomUUID()),
		])[0];
		await drained(
			await runTurn(
				session,
				{ chatId, event: { token: "" } },
				opening,
				new AbortController().signal,
				{},
			),
		);
	},
	async reply(session, chatId, message, { maxSteps, signal }) {
		let outcome: TurnOutcome = { stopped: "stopped without answering" };
		await drained(
			await runTurn(
				session,
				{ chatId, event: { token: "" } },
				{ id: crypto.randomUUID(), type: "human", content: message },
				signal,
				{},
				{ maxSteps, onOutcome: (ended) => (outcome = ended) },
			),
		);
		return outcome;
	},
	source: (chatId) => ({ repls, threadId: chatId }),
});

export const steer = {
	middleware: [...authed, body(steerRequestSchema)] as const,
	handler: async ({
		context,
	}: Authed<z.infer<typeof steerRequestSchema>>): Promise<Response> => {
		const { chatId, id, message } = context.body;
		const accepted = await steers.post(
			steerKey(context.session.subject, chatId),
			{ kind: "user", id, content: message },
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
