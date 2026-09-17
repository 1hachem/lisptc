import type { ChatMessageInput } from "@repo/ai";

const TYPES = new Set(["human", "ai", "system", "tool"]);

export interface StoredMessage {
	type: "human" | "ai" | "system" | "tool";
	content: string;
	kwargs?: Record<string, unknown>;
}

export function toInput(stored: StoredMessage[]): ChatMessageInput[] {
	return stored.map((message) => ({
		type: message.type,
		content: message.content,
		additional_kwargs: message.kwargs,
	}));
}

export function toStored(wire: Record<string, unknown>[]): StoredMessage[] {
	const stored: StoredMessage[] = [];
	for (const message of wire) {
		const type = message.type;
		if (typeof type !== "string" || !TYPES.has(type)) continue;
		stored.push({
			type: type as StoredMessage["type"],
			content: typeof message.content === "string" ? message.content : "",
			kwargs: message.additional_kwargs as Record<string, unknown> | undefined,
		});
	}
	return stored;
}
