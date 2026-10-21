import type { ChatMessage } from "./chat.tsx";

export function turnsToShow(
	streamed: ChatMessage[],
	persisted: ChatMessage[],
	streaming: boolean,
): ChatMessage[] {
	return streaming || streamed.length > persisted.length ? streamed : persisted;
}

function sameMessage(a: ChatMessage, b: ChatMessage): boolean {
	if (a === b) return true;
	if (a.type !== b.type) return false;
	if (
		a.content !== b.content &&
		JSON.stringify(a.content) !== JSON.stringify(b.content)
	)
		return false;
	return (
		a.additional_kwargs === b.additional_kwargs ||
		JSON.stringify(a.additional_kwargs) === JSON.stringify(b.additional_kwargs)
	);
}

export function keepUnchanged(
	previous: ReadonlyMap<string, ChatMessage>,
	next: ChatMessage[],
): ChatMessage[] {
	return next.map((message) => {
		const before =
			message.id === undefined ? undefined : previous.get(message.id);
		return before !== undefined && sameMessage(before, message)
			? before
			: message;
	});
}

export function isFreshChat(
	chatId: string | null,
	turns: ChatMessage[],
): boolean {
	return chatId === null && turns.length === 0;
}
