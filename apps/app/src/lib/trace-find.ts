import {
	type ChatMessage,
	isToolMessage,
	messageText,
	toolModelOutput,
} from "./chat.tsx";
import { entriesOfMessage, isEntryMessage } from "./entries.ts";

function searchedText(message: ChatMessage): string {
	if (isEntryMessage(message))
		return JSON.stringify(entriesOfMessage(message).map((e) => e.value));
	if (isToolMessage(message)) return toolModelOutput(message).output;
	return messageText(message);
}

export function messageMatches(message: ChatMessage, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === "") return false;
	return searchedText(message).toLowerCase().includes(needle);
}
