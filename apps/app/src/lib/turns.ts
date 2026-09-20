import type { ChatMessage } from "./chat.tsx";

export function turnsToShow(
	streamed: ChatMessage[],
	persisted: ChatMessage[],
	streaming: boolean,
): ChatMessage[] {
	return streaming || streamed.length > persisted.length ? streamed : persisted;
}

export function isFreshChat(
	chatId: string | null,
	turns: ChatMessage[],
): boolean {
	return chatId === null && turns.length === 0;
}
