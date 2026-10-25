import {
	type Envelope,
	MemoryMailbox,
	type Posted,
	type PostOptions,
	Thread,
	Threads,
	type WireMessage,
} from "@repo/ai";
import { inProcessJobs } from "@repo/backend/agent-repl";
import type { Id } from "@repo/backend/dataModel";
import { ThreadHost } from "@repo/backend/thread-host";
import { convexAs, convexAsServer } from "./convex.ts";
import { currentSession } from "./session.ts";
import { subAgents } from "./sub-agents.ts";

export interface Identity {
	readonly distinctId?: string;
	readonly sessionId?: string;
}

export const host: ThreadHost = new ThreadHost({
	server: convexAsServer,
	connect: () => convexAs(currentSession()),
	jobs: inProcessJobs((workspaceId, chatId) =>
		subAgents(host, relay)(workspaceId, chatId),
	),
});

const identities = new Map<string, Identity>();

const ports = host.ports(new MemoryMailbox());

const threads = new Threads(
	(chatId) =>
		new Thread(chatId, {
			...ports,
			setup: async (id) => ({
				...(await ports.setup(id)),
				identity: identities.get(id),
			}),
		}),
);

export function post(
	chatId: Id<"chats">,
	envelope: Envelope,
	options?: PostOptions,
	identity?: Identity,
): Promise<Posted> {
	if (identity !== undefined) identities.set(chatId, identity);
	return threads.get(chatId).post(envelope, options);
}

export function watch(chatId: Id<"chats">, signal: AbortSignal): Response {
	return threads.get(chatId).watch(signal);
}

export function stop(chatId: Id<"chats">): boolean {
	return threads.get(chatId).stop();
}

function relay(chatId: Id<"chats">, message: WireMessage): void {
	threads.get(chatId).relay(message);
}

export function withdraw(chatId: Id<"chats">, id: string): Promise<boolean> {
	return threads.get(chatId).withdraw(id);
}
