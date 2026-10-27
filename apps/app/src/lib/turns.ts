import type { ChatMessage } from "./chat.tsx";

export function isFreshChat(
	chatId: string | null,
	turns: readonly ChatMessage[],
): boolean {
	return chatId === null && turns.length === 0;
}
