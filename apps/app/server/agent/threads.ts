import {
	type Envelope,
	MemoryMailbox,
	type Posted,
	type PostOptions,
	Threads,
	type UiActionResult,
} from "@repo/ai";
import type { Id } from "@repo/backend/dataModel";
import { MAX_SPAWN_DEPTH } from "@repo/backend/limits";
import { ThreadHost } from "@repo/backend/thread-host";
import { desktops } from "../desktop/registry.ts";
import { convexActingAs, convexAsServer } from "./convex.ts";

export interface Identity {
	readonly distinctId?: string;
	readonly sessionId?: string;
}

const host: ThreadHost = new ThreadHost({
	server: convexAsServer,
	actAs: convexActingAs,
	threads: () => threads,
	bridge: desktops,
});

const telemetry = new Map<string, Identity>();

const supervised = host.supervised(new MemoryMailbox());

export const threads = new Threads(
	{
		...supervised,
		ports: {
			...supervised.ports,
			setup: async (id) => ({
				...(await supervised.ports.setup(id)),
				identity: telemetry.get(id),
			}),
		},
	},
	{ maxDepth: MAX_SPAWN_DEPTH },
);

export function post(
	chatId: Id<"chats">,
	envelope: Envelope,
	options?: PostOptions,
	identity?: Identity,
): Promise<Posted> {
	if (identity !== undefined) telemetry.set(chatId, identity);
	return threads.get(chatId).post(envelope, options);
}

export function watchThread(
	chatId: Id<"chats">,
	signal: AbortSignal,
): Response {
	return threads.watch(chatId, signal);
}

export function stopThread(
	chatId: Id<"chats">,
	scope: "thread" | "tree",
): Promise<boolean> {
	return threads.stop(chatId, scope);
}

export function answer(
	chatId: Id<"chats">,
	action: string,
	values: Record<string, unknown>,
	ask?: string,
): Promise<UiActionResult> {
	return threads.answer(chatId, action, values, ask);
}

export function withdrawPost(
	chatId: Id<"chats">,
	id: string,
): Promise<boolean> {
	return threads.get(chatId).withdraw(id);
}
