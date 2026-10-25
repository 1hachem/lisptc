import {
	type Envelope,
	MemoryMailbox,
	type Posted,
	type PostOptions,
	Thread,
	type ThreadStatus,
	Threads,
	type TranscriptStore,
	type TurnSetup,
	type WireMessage,
} from "@repo/ai";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { TURN_DEADLINE_MS } from "@repo/backend/limits";
import { convexAs } from "./convex.ts";
import { toInput, toStored } from "./history.ts";
import { chatModel } from "./model.ts";
import { repls } from "./repls.ts";
import type { Session } from "./session.ts";

export interface Poster {
	readonly session: Session;
	readonly identity?: { distinctId?: string; sessionId?: string };
}

const posters = new Map<string, Poster>();

function posterOf(chatId: string): Poster {
	const found = posters.get(chatId);
	if (found === undefined) throw new Error(`chat=${chatId} has no poster`);
	return found;
}

const convexFor = (chatId: string) => convexAs(posterOf(chatId).session);

const asChat = (chatId: string) => chatId as Id<"chats">;

const transcript: TranscriptStore = {
	async read(chatId) {
		return toInput(
			await convexFor(chatId).query(api.messages.transcript, {
				chatId: asChat(chatId),
			}),
		);
	},
	async append(chatId, messages) {
		await convexFor(chatId).mutation(api.messages.append, {
			chatId: asChat(chatId),
			messages: toStored(messages),
		});
	},
	async annotate(chatId, id, kwargs) {
		await convexFor(chatId).mutation(api.messages.annotate, {
			chatId: asChat(chatId),
			id,
			kwargs,
		});
	},
};

const status: ThreadStatus = {
	async start(chatId) {
		await convexFor(chatId).mutation(api.chats.start, {
			chatId: asChat(chatId),
		});
	},
	async settle(chatId, failure) {
		await convexFor(chatId).mutation(api.chats.settle, {
			chatId: asChat(chatId),
			failure,
		});
	},
};

async function setup(chatId: string): Promise<TurnSetup> {
	const convex = convexFor(chatId);
	const { workspaceId, agent } = await convex.query(api.chats.get, {
		chatId: asChat(chatId),
	});
	const { provider, model } = chatModel(
		(await convex.query(api.workspaces.get, { workspaceId })).model,
	);
	const runsForms =
		(await convex.query(api.preferences.get, {})).input?.lisp !== false;
	return {
		config: {
			provider,
			model,
			...(agent === undefined ? {} : { instructions: agent.prompt }),
		},
		runsForms,
		deadlineMs: TURN_DEADLINE_MS,
		identity: posterOf(chatId).identity,
	};
}

const mailbox = new MemoryMailbox();

const threads = new Threads(
	(chatId) =>
		new Thread(chatId, {
			mailbox,
			repl: (id) => repls.get(asChat(id)),
			transcript,
			status,
			setup,
		}),
);

export function post(
	poster: Poster,
	chatId: Id<"chats">,
	envelope: Envelope,
	options?: PostOptions,
): Promise<Posted> {
	posters.set(chatId, poster);
	return threads.get(chatId).post(envelope, options);
}

export function watch(chatId: Id<"chats">, signal: AbortSignal): Response {
	return threads.get(chatId).watch(signal);
}

export function stop(chatId: Id<"chats">): boolean {
	return threads.get(chatId).stop();
}

export function relay(chatId: Id<"chats">, message: WireMessage): void {
	threads.get(chatId).relay(message);
}

export function withdraw(chatId: Id<"chats">, id: string): Promise<boolean> {
	return threads.get(chatId).withdraw(id);
}
