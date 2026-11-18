import type { ChatMessage } from "@repo/components";

export function isFreshChat(
	chatId: string | null,
	turns: readonly ChatMessage[],
): boolean {
	return chatId === null && turns.length === 0;
}
