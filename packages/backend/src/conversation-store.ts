import type { ConversationStore } from "@repo/conversation-extension";
import type { ConversationEntry } from "@repo/interpreter/conversation";
import type { Problem } from "@repo/interpreter/session";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type ConversationClient = Pick<ConvexHttpClient, "query">;

const ROLES = {
	human: "user",
	ai: "assistant",
	system: "system",
	tool: "tool",
} as const;

interface Row {
	type: keyof typeof ROLES;
	content: string;
}

function toolResult(
	content: string,
): { output: string; problems?: Problem[] } | undefined {
	try {
		const parsed = JSON.parse(content) as {
			type?: unknown;
			output?: unknown;
			problems?: unknown;
		};
		if (parsed?.type !== "tool_result") return undefined;
		return {
			output: String(parsed.output ?? ""),
			...(Array.isArray(parsed.problems)
				? { problems: parsed.problems as Problem[] }
				: {}),
		};
	} catch {
		return undefined;
	}
}

export function entryOf({ type, content }: Row): ConversationEntry {
	const role = ROLES[type];
	const result = role === "tool" ? toolResult(content) : undefined;
	if (result === undefined) return { role, content };
	return {
		role,
		content: result.output,
		...(result.problems ? { problems: result.problems } : {}),
	};
}

export class ConvexConversationStore implements ConversationStore {
	constructor(
		private readonly chatId: Id<"chats">,
		private readonly connect: () => ConversationClient,
	) {}

	async stored(): Promise<ConversationEntry[]> {
		const rows = await this.connect().query(api.messages.transcript, {
			chatId: this.chatId,
		});
		return rows.map(entryOf);
	}
}
