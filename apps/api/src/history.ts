import type { ChatMessageInput, WireMessage } from "@repo/ai";

const TYPES = new Set<string>(["human", "ai", "system", "tool"]);

export interface StoredMessage {
	type: "human" | "ai" | "system" | "tool";
	content: string;
	kwargs?: Record<string, unknown>;
}

function isStoredType(value: string): value is StoredMessage["type"] {
	return TYPES.has(value);
}

export function toInput(stored: StoredMessage[]): ChatMessageInput[] {
	return stored.map((message) => ({
		type: message.type,
		content: message.content,
		additional_kwargs: message.kwargs,
	}));
}

export function toStored(wire: WireMessage[]): StoredMessage[] {
	const stored: StoredMessage[] = [];
	for (const message of wire) {
		if (!isStoredType(message.type)) continue;
		stored.push({
			type: message.type,
			content: message.content,
			kwargs: message.additional_kwargs,
		});
	}
	return stored;
}
