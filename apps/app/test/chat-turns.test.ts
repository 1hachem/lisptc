import { describe, expect, test, vi } from "vitest";
import {
	briefingOf,
	type ChatMessage,
	isParentMessage,
	isUserMessage,
} from "../src/lib/chat.tsx";
import { groupTurns, shapeTurn } from "../src/lib/turn-groups.ts";
import { isFreshChat, turnsToShow } from "../src/lib/turns.ts";

vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: () => {} }));

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

describe("a sub-agent's conversation", () => {
	test("opens on the request its parent sent", () => {
		const request: ChatMessage = {
			id: "ask",
			type: "system",
			content: "summarise the upload",
			additional_kwargs: { source: "agent:parent" },
		};
		const [turn] = groupTurns([request, ...messages("a")]);
		expect(turn?.asked).toBe(request);
		expect(isParentMessage(request)).toBe(true);
		expect(isUserMessage(request)).toBe(false);
	});

	test("keeps any other system event inside the turn", () => {
		const event: ChatMessage = {
			id: "e",
			type: "system",
			content: "timer fired",
			additional_kwargs: { source: "timer" },
		};
		const [turn] = groupTurns([event]);
		expect(turn?.asked).toBeUndefined();
	});
});

describe("a sub-agent's briefing", () => {
	test("opens the conversation on the prompt it was spawned with", () => {
		const [briefing] = briefingOf({
			_id: "child",
			parentChatId: "parent",
			agent: { prompt: "you review uploads" },
		});
		expect(briefing && isParentMessage(briefing)).toBe(true);
		expect(briefing?.content).toBe("you review uploads");
	});

	test("is empty on a chat no agent spawned", () => {
		expect(briefingOf({ _id: "chat" })).toEqual([]);
	});
});

describe("a form the user ran from the input", () => {
	const ran = (quiet: boolean): ChatMessage => ({
		id: "ran",
		type: "tool",
		content: "",
		additional_kwargs: {
			display: "(1 2 3)",
			...(quiet ? { quiet: true } : {}),
		},
	});
	const asked: ChatMessage = {
		id: "u",
		type: "human",
		content: "(list 1 2 3)",
	};

	test.each([
		false,
		true,
	])("stays in the chat body when quiet is %s", (quiet) => {
		const [turn] = groupTurns([asked, ran(quiet)]);
		const chain = turn === undefined ? [] : shapeTurn(turn).chain;
		expect(chain).toMatchObject([{ kind: "call", ran: true }]);
	});

	test("leaves a quiet step the agent ran out of it", () => {
		const call: ChatMessage = { id: "c", type: "ai", content: "" };
		const [turn] = groupTurns([asked, call, ran(true)]);
		const chain = turn === undefined ? [] : shapeTurn(turn).chain;
		expect(chain).toMatchObject([{ kind: "text" }]);
	});
});
