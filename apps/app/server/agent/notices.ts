import type { Notice } from "@repo/agents-extension/ports";
import type { Id } from "@repo/backend/dataModel";
import type { Session } from "./session.ts";

export interface Noticed {
	readonly session: Session;
	readonly chatId: Id<"chats">;
	readonly notice: Notice;
}

type Listener = (noticed: Noticed) => Promise<void>;

let listener: Listener | undefined;

export function onNotice(listen: Listener): void {
	listener = listen;
}

export function notice(noticed: Noticed): void {
	listener?.(noticed).catch((error: unknown) =>
		console.error(`chat=${noticed.chatId} missed a sub-agent's reply:`, error),
	);
}
