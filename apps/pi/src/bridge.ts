import { stripFences } from "@repo/ai";
import { formsOnly } from "@repo/shared/lisp-forms";

export interface Turn {
	readonly role: string;
	readonly content: string;
}

export function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	let text = "";
	for (const part of content) {
		if (typeof part !== "object" || part === null) continue;
		const { type, text: body } = part as { type?: unknown; text?: unknown };
		if (type === "text" && typeof body === "string") text += body;
	}
	return text;
}

export function stepCode(text: string): string | undefined {
	const code = stripFences(text);
	return formsOnly(code).trim() === "" ? undefined : code;
}

export function capped(steps: number, maxSteps: number): boolean {
	return steps >= maxSteps;
}

export function conversationVars(
	turns: readonly Turn[],
): Record<string, unknown> {
	const said = (role: string) =>
		turns.filter((t) => t.role === role).map((t) => t.content);
	return {
		conversation: turns.map((t) => ({ role: t.role, content: t.content })),
		"user-messages": said("user"),
		"assistant-messages": said("assistant"),
	};
}

export function transcriptOf(sessions: unknown): Turn[] {
	const build = (sessions as { buildSessionContext?: () => unknown })
		?.buildSessionContext;
	if (typeof build !== "function") return [];
	try {
		const context = build.call(sessions) as { messages?: unknown };
		return turnsFrom(context?.messages);
	} catch {
		return [];
	}
}

export function turnsFrom(messages: unknown): Turn[] {
	if (!Array.isArray(messages)) return [];
	const turns: Turn[] = [];
	for (const message of messages) {
		if (typeof message !== "object" || message === null) continue;
		const { role, content } = message as { role?: unknown; content?: unknown };
		if (role !== "user" && role !== "assistant") continue;
		turns.push({ role, content: messageText(content) });
	}
	return turns;
}
