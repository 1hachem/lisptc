import type { ChatMessage } from "./chat.tsx";

export interface Written {
	text: string;
	because?: string;
	from?: string;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function messageWritten(message: ChatMessage): Written | undefined {
	const written = message.additional_kwargs?.written;
	if (typeof written !== "object" || written === null) return undefined;
	const { text, because, from } = written as Record<string, unknown>;
	if (typeof text !== "string") return undefined;
	const reason = optionalString(because);
	const base = optionalString(from);
	return {
		text,
		...(reason === undefined ? {} : { because: reason }),
		...(base === undefined ? {} : { from: base }),
	};
}
