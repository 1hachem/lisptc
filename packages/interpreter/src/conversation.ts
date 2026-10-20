import { type Problem, slot } from "./session.ts";

export interface ConversationEntry {
	readonly role: "user" | "assistant" | "system" | "tool";
	readonly content: string;
	readonly problems?: readonly Problem[];
}

export interface Conversation {
	entries(): readonly ConversationEntry[];
}

export const conversationSlot = slot<Conversation>("conversation");
