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

type Row = StoredMessage & { _id: string; wireId?: string };

const isUserEval = (previous: Row | undefined, message: Row): boolean =>
	message.type === "tool" && previous?.type === "human";

function withEval(human: ChatMessageInput, result: Row): ChatMessageInput {
	const riding = result.kwargs?.riding;
	return {
		...human,
		content: [
			human.content,
			result.content,
			...(typeof riding === "string" ? [riding] : []),
		].join("\n\n"),
	};
}

export function toInput(stored: Row[]): {
	messages: ChatMessageInput[];
	rows: number[];
} {
	const messages: ChatMessageInput[] = [];
	const rows: number[] = [];
	stored.forEach((message, row) => {
		if (isUserEval(stored[row - 1], message)) {
			messages[messages.length - 1] = withEval(messages.at(-1) ?? {}, message);
			return;
		}
		messages.push({
			id: message.wireId ?? message._id,
			type: message.type,
			content: message.content,
			additional_kwargs: message.kwargs,
		});
		rows.push(row);
	});
	return { messages, rows };
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
