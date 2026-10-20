import { describe, expect, it } from "vitest";
import {
	type ConversationEntry,
	conversationSlot,
} from "../src/conversation.ts";
import { newSessionHooks } from "../src/session.ts";

describe("conversationSlot", () => {
	it("is the key a session's conversation is handed over under", () => {
		expect(conversationSlot).toEqual({ name: "conversation" });
	});

	it("carries a source a consumer reads when it needs the entries", () => {
		const hooks = newSessionHooks();
		let entries: ConversationEntry[] = [{ role: "user", content: "hi" }];
		hooks.fill(conversationSlot, { entries: () => entries });
		entries = [...entries, { role: "assistant", content: "(echo 1)" }];
		expect(hooks.filled(conversationSlot)?.entries()).toHaveLength(2);
	});
});
