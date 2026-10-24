import { asksOf } from "./asks.ts";
import type { ChatMessage } from "./chat.tsx";

function withAsksPostedMeanwhile(
	streamed: ChatMessage[],
	persisted: ChatMessage[],
): ChatMessage[] {
	const shown = new Set(streamed.map((message) => message.id));
	const posted = persisted.filter(
		(message) =>
			!shown.has(message.id) && asksOf(message.additional_kwargs).length > 0,
	);
	return posted.length === 0 ? streamed : [...streamed, ...posted];
}

export function turnsToShow(
	streamed: ChatMessage[],
	persisted: ChatMessage[],
	streaming: boolean,
): ChatMessage[] {
	return streaming || streamed.length > persisted.length
		? withAsksPostedMeanwhile(streamed, persisted)
		: persisted;
}

export function isFreshChat(
	chatId: string | null,
	turns: ChatMessage[],
): boolean {
	return chatId === null && turns.length === 0;
}
