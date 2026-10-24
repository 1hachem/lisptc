import type { Notice } from "@repo/agents-extension/ports";
import type { ReplSource, TurnOutcome } from "@repo/ai";
import type { Id } from "@repo/backend/dataModel";
import type { Session } from "./session.ts";

export interface Noticed {
	readonly session: Session;
	readonly chatId: Id<"chats">;
	readonly notice: Notice;
}

export interface Budget {
	readonly maxSteps: number;
	readonly signal: AbortSignal;
}

export interface ChatTurns {
	wake(noticed: Noticed): Promise<void>;
	reply(
		session: Session,
		chatId: Id<"chats">,
		message: string,
		budget: Budget,
	): Promise<TurnOutcome>;
	source(chatId: Id<"chats">): ReplSource<Id<"chats">>;
}

let served: ChatTurns | undefined;

export function serveTurns(turns: ChatTurns): void {
	served = turns;
}

export function chatTurns(): ChatTurns {
	if (served === undefined) throw new Error("no chat turns are served yet");
	return served;
}

export function notice(noticed: Noticed): void {
	chatTurns()
		.wake(noticed)
		.catch((error: unknown) =>
			console.error(
				`chat=${noticed.chatId} missed a sub-agent's reply:`,
				error,
			),
		);
}
