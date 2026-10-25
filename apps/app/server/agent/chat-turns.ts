import type { Notice } from "@repo/agents-extension/ports";
import type { TurnOutcome } from "@repo/ai";
import type { Id } from "@repo/backend/dataModel";

export interface Noticed {
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
		chatId: Id<"chats">,
		message: string,
		budget: Budget,
	): Promise<TurnOutcome>;
	spawn(
		parent: Id<"chats">,
		create: () => Promise<Id<"chats">>,
	): Promise<Id<"chats">>;
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
