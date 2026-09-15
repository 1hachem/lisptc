import {
	type ChatMessage,
	isGreetingMessage,
	isToolMessage,
	isUserMessage,
	messageText,
	toolResult,
	toolUi,
} from "./chat.tsx";
import { toUiNode, viewText } from "./view.ts";

function section(label: string, body: string): string | null {
	const trimmed = body.trim();
	return trimmed ? `## ${label}\n\n${trimmed}` : null;
}

function render(message: ChatMessage): string | null {
	if (isToolMessage(message)) {
		const view = toUiNode(toolUi(message));
		if (view) return section("view", viewText(view));
		const { output, error } = toolResult(message);
		return section(error ? "repl (error)" : "repl", output);
	}
	return section(
		isUserMessage(message) ? "user" : "assistant",
		messageText(message),
	);
}

export function transcript(messages: ChatMessage[]): string {
	return messages
		.filter((m) => !isGreetingMessage(m))
		.map(render)
		.filter((s) => s !== null)
		.join("\n\n");
}
