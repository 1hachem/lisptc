import type { Interp } from "./lisp.ts";
import { type ConversationEntry, slot } from "./session.ts";

export interface Conversation {
	entries(interp: Interp): readonly ConversationEntry[];
}

export const conversationSlot = slot<Conversation>("conversation");
