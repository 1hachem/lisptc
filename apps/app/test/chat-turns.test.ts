import { describe, expect, test } from "vitest";
import type { ChatMessage } from "../src/lib/chat.tsx";
import { isFreshChat, turnsToShow } from "../src/lib/turns.ts";

function messages(...ids: string[]): ChatMessage[] {
	return ids.map((id) => ({ id, type: "ai", content: id }));
}

describe("which turns the view reads", () => {
	test("takes the stream while it runs", () => {
		const streamed = messages("a", "b", "c");
		expect(turnsToShow(streamed, messages("a"), true)).toBe(streamed);
	});

	test("holds the stream after it ends until convex catches up", () => {
		const streamed = messages("a", "b", "c");
		expect(turnsToShow(streamed, messages("a"), false)).toBe(streamed);
	});

	test("hands over once convex has every turn", () => {
		const persisted = messages("a", "b", "c");
		expect(turnsToShow(messages("a", "b", "c"), persisted, false)).toBe(
			persisted,
		);
	});

	test("hands over when convex runs ahead of a stale stream", () => {
		const persisted = messages("a", "b", "c", "d");
		expect(turnsToShow(messages("a", "b"), persisted, false)).toBe(persisted);
	});

	test("takes an empty stream over an empty transcript while running", () => {
		const streamed: ChatMessage[] = [];
		expect(turnsToShow(streamed, [], true)).toBe(streamed);
	});
});

describe("where the input sits", () => {
	test("centres a chat that has no id and nothing sent", () => {
		expect(isFreshChat(null, [])).toBe(true);
	});

	test("drops to the bottom the moment a first turn is in flight", () => {
		expect(isFreshChat(null, messages("a"))).toBe(false);
	});

	test("never centres a chat opened by id, even before its turns land", () => {
		expect(isFreshChat("chat-1", [])).toBe(false);
	});
});
