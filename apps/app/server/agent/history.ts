import type { ChatMessageInput, WireMessage } from "@repo/ai";

const TYPES = new Set<string>(["human", "ai", "system", "tool"]);

export interface StoredMessage {
	id?: string;
	type: "human" | "ai" | "system" | "tool";
	content: string;
	kwargs?: Record<string, unknown>;
}

function isStoredType(value: string): value is StoredMessage["type"] {
	return TYPES.has(value);
}

export function toInput(
	stored: (StoredMessage & { _id: string; wireId?: string })[],
): ChatMessageInput[] {
	return stored.map((message) => ({
		id: message.wireId ?? message._id,
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
			id: message.id,
			type: message.type,
			content: message.content,
			kwargs: message.additional_kwargs,
		});
	}
	return stored;
}
