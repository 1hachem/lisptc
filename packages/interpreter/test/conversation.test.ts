import { describe, expect, it } from "vitest";
import { conversationSlot } from "../src/conversation.ts";
import { type ConversationEntry, newSessionHooks } from "../src/session.ts";
import { freshInterp } from "./helpers.ts";

describe("conversationSlot", () => {
	it("is the key a session's conversation is handed over under", () => {
		expect(conversationSlot).toEqual({ name: "conversation" });
	});

	it("carries a source a consumer reads off the interp when it needs the entries", () => {
		const hooks = newSessionHooks();
		const interp = freshInterp();
		let entries: ConversationEntry[] = [{ role: "user", content: "hi" }];
		hooks.fill(conversationSlot, {
			entries: (from) => (from === interp ? entries : []),
			replace: () => {},
		});
		entries = [...entries, { role: "assistant", content: "(echo 1)" }];
		expect(hooks.filled(conversationSlot)?.entries(interp)).toHaveLength(2);
	});
});
