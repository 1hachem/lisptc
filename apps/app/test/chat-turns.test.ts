import { describe, expect, test } from "vitest";
import type { ChatMessage } from "../src/lib/chat.tsx";
import { isFreshChat, keepUnchanged, turnsToShow } from "../src/lib/turns.ts";

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

describe("which messages keep their identity across chunks", () => {
	const byId = (list: ChatMessage[]) =>
		new Map(list.map((m) => [m.id ?? "", m]));

	test("hands back the earlier object for a message that did not change", () => {
		const before = [
			{
				id: "a",
				type: "ai",
				content: "a",
				additional_kwargs: { meta: { at: "t" } },
			},
		];
		const after = [
			{
				id: "a",
				type: "ai",
				content: "a",
				additional_kwargs: { meta: { at: "t" } },
			},
		];
		expect(keepUnchanged(byId(before), after)[0]).toBe(before[0]);
	});

	test("takes the new object for a message still streaming", () => {
		const after = messages("a", "b2");
		const kept = keepUnchanged(byId(messages("a", "b")), [
			after[0] as ChatMessage,
			{ id: "b", type: "ai", content: "b2" },
		]);
		expect(kept[1]?.content).toBe("b2");
	});

	test("takes the new object when only the extras changed", () => {
		const before = [{ id: "t", type: "tool", content: "x" }];
		const after = [
			{
				id: "t",
				type: "tool",
				content: "x",
				additional_kwargs: { failed: true as const },
			},
		];
		expect(keepUnchanged(byId(before), after)[0]).toBe(after[0]);
	});
});
