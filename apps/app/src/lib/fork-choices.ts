import type { Choice } from "@repo/components/choice-dialog.tsx";
import type { ChatMessage } from "./chat.tsx";
import { isGreetingMessage } from "./greeting.ts";

const SNIPPET = 90;

const SPEAKERS: Record<string, string> = {
	human: "You",
	ai: "Agent",
	tool: "REPL",
	system: "System",
};

function snippet(content: unknown): string {
	const text = (typeof content === "string" ? content : JSON.stringify(content))
		.replace(/\s+/g, " ")
		.trim();
	return text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text;
}

export function forkChoices(messages: readonly ChatMessage[]): Choice[] {
	return messages
		.filter(
			(message) => message.id !== undefined && !isGreetingMessage(message),
		)
		.map((message) => ({
			id: message.id as string,
			name: `${SPEAKERS[message.type] ?? message.type}: ${snippet(message.content) || "(empty)"}`,
		}));
}
