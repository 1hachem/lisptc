import { filePrompt } from "@repo/shared/host-node";
import type { ConversationHost } from "./conversation.ts";

export const conversationHost: ConversationHost = {
	prompt: filePrompt(new URL("./conversation.ptc", import.meta.url)),
};
