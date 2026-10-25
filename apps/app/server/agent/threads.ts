import {
	type AskOptions,
	type Envelope,
	MemoryMailbox,
	type Posted,
	type PostOptions,
	Threads,
	type TurnOutcome,
	type UiActionResult,
} from "@repo/ai";
import { inProcessJobs } from "@repo/backend/agent-repl";
import type { Id } from "@repo/backend/dataModel";
import { MAX_SPAWN_DEPTH } from "@repo/backend/limits";
import { ThreadHost } from "@repo/backend/thread-host";
import { convexActingAs, convexAsServer } from "./convex.ts";
import { subAgents } from "./sub-agents.ts";

export interface Identity {
	readonly distinctId?: string;
	readonly sessionId?: string;
}

const host: ThreadHost = new ThreadHost({
	server: convexAsServer,
	actAs: convexActingAs,
	jobs: inProcessJobs((workspaceId, chatId) =>
		subAgents(host)(workspaceId, chatId),
	),
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

export function ask(
	chatId: Id<"chats">,
	envelope: Envelope,
	options?: AskOptions,
): Promise<string> {
	return threads.ask(chatId, envelope, options);
}

export function wait(job: string, signal?: AbortSignal): Promise<TurnOutcome> {
	return threads.wait(job, signal);
}

export async function spawn(
	parent: Id<"chats">,
	create: () => Promise<Id<"chats">>,
): Promise<Id<"chats">> {
	return (await threads.spawn(parent, create)) as Id<"chats">;
}

export function watch(chatId: Id<"chats">, signal: AbortSignal): Response {
	return threads.get(chatId).watch(signal);
}

export function stop(chatId: Id<"chats">): Promise<boolean> {
	return threads.cancel(chatId);
}

export function answer(
	chatId: Id<"chats">,
	action: string,
	values: Record<string, unknown>,
	ask?: string,
): Promise<UiActionResult> {
	return threads.answer(chatId, action, values, ask);
}

export function withdraw(chatId: Id<"chats">, id: string): Promise<boolean> {
	return threads.get(chatId).withdraw(id);
}
