import { filePrompt } from "@repo/shared/host-node";
import type { ConversationHost, ConversationStore } from "./conversation.ts";

export const unstoredConversation: ConversationStore = { stored: () => [] };

export function conversationHostFor(
	store: ConversationStore = unstoredConversation,
): ConversationHost {
	return {
		prompt: filePrompt(new URL("./conversation.ptc", import.meta.url)),
		store,
	};
}

export const conversationHost: ConversationHost = conversationHostFor();
