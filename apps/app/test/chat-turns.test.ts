import { type KwargMessage, lighten } from "@repo/shared/messages";
import { describe, expect, test, vi } from "vitest";
import {
	briefingOf,
	type ChatMessage,
	isParentMessage,
	isUserMessage,
	toolResult,
} from "../src/lib/chat.tsx";
import { type Sequenced, timelineOf } from "../src/lib/timeline.ts";
import { groupTurns, shapeTurn } from "../src/lib/turn-groups.ts";
import { placeTimeline } from "../src/lib/turn-timeline.ts";
import { isFreshChat } from "../src/lib/turns.ts";

vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: () => {} }));

function messages(...ids: string[]): ChatMessage[] {
	return ids.map((id) => ({ id, type: "ai", content: id }));
}

describe("which turns the view reads", () => {
	const at = (seq: number, id: string): Sequenced => ({
		seq,
		message: { id, type: "ai", content: id },
	});
	const ids = (timeline: readonly ChatMessage[]) =>
		timeline.map((message) => message.id);

	test("takes the stream's copy of a stored message while it runs", () => {
		const live: ChatMessage = { id: "a", type: "ai", content: "growing" };
		expect(timelineOf([at(0, "a")], [live], true)).toEqual([live]);
	});

	test("takes the stored copy once the turn is over", () => {
		const live: ChatMessage = { id: "a", type: "ai", content: "stale" };
		expect(timelineOf([at(0, "a")], [live], false)).toEqual([
			at(0, "a").message,
		]);
	});

	test("keeps what convex has not caught up on after the turn", () => {
		expect(ids(timelineOf([at(0, "a")], messages("a", "b"), false))).toEqual([
			"a",
			"b",
		]);
	});

	test("puts the message being sent last, once", () => {
		const sent: ChatMessage = { id: "u", type: "human", content: "hi" };
		expect(ids(timelineOf([at(0, "a")], [], false, sent))).toEqual(["a", "u"]);
		expect(ids(timelineOf([at(0, "a"), at(1, "u")], [], false, sent))).toEqual([
			"a",
			"u",
		]);
	});

	test("refuses a transcript out of seq order", () => {
		expect(() => timelineOf([at(1, "a"), at(0, "b")], [], false)).toThrow(
			/out of order/,
		);
	});

	test("refuses a transcript holding one message twice", () => {
		expect(() => timelineOf([at(0, "a"), at(1, "a")], [], false)).toThrow(
			/twice/,
		);
	});

	test("shows every interleaving of stored and streamed in the order written", () => {
		let state = 7;
		const random = (below: number) => {
			state = (state * 1103515245 + 12345) % 2147483648;
			return state % below;
		};
		for (let run = 0; run < 500; run += 1) {
			const written = Array.from({ length: 1 + random(12) }, (_, i) => `m${i}`);
			const caught = random(written.length + 1);
			const stored = written.slice(0, caught).map((id, i) => at(i * 2, id));
			const live = written.filter((_, i) => i >= caught || random(2) === 0);
			const running = random(2) === 0;
			expect(ids(timelineOf(stored, messages(...live), running))).toEqual(
				written,
			);
		}
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
	const ran = (quiet: boolean): ChatMessage & KwargMessage => ({
		id: "ran",
		type: "tool",
		content: "",
		additional_kwargs: {
			display: "(1 2 3)",
			...(quiet ? { quiet: true } : {}),
		},
	});
	const asked: ChatMessage & KwargMessage = {
		id: "u",
		type: "human",
		content: "(list 1 2 3)",
	};

	test.each([
		false,
		true,
	])("stays in the chat body when quiet is %s", (quiet) => {
		const [turn] = groupTurns(lighten([asked, ran(quiet)]));
		const chain = turn === undefined ? [] : shapeTurn(turn).chain;
		expect(chain).toMatchObject([{ kind: "call", ran: true }]);
		const [link] = chain;
		const printed = link?.kind === "call" ? toolResult(link.result).output : "";
		expect(printed).toBe("(1 2 3)");
	});

	test("leaves a quiet step the agent ran out of it", () => {
		const call: ChatMessage = { id: "c", type: "ai", content: "" };
		const [turn] = groupTurns([asked, call, ran(true)]);
		const chain = turn === undefined ? [] : shapeTurn(turn).chain;
		expect(chain).toMatchObject([{ kind: "text" }]);
	});
});

describe("activity a quiet step started", () => {
	test("is placed under the call that came before the quiet step", () => {
		const turn = {
			id: "turn",
			asked: { id: "u", type: "human", content: "(list 1 2 3)" } as ChatMessage,
			steps: [
				{ id: "a", type: "ai", content: "a" },
				{ id: "t1", type: "tool", content: "", additional_kwargs: {} },
				{
					id: "q",
					type: "tool",
					content: "",
					additional_kwargs: {
						quiet: true,
						activity: [
							{ id: "apify", kind: "mcp", label: "apify", state: "done" },
						],
					},
				},
				{ id: "b", type: "ai", content: "b" },
				{ id: "t2", type: "tool", content: "", additional_kwargs: {} },
			] as ChatMessage[],
		};
		const shape = shapeTurn(turn);
		const first = shape.chain.findIndex(
			(link) => link.kind === "call" && link.result.id === "t1",
		);
		const last = shape.chain.findIndex(
			(link) => link.kind === "call" && link.result.id === "t2",
		);
		const placed = placeTimeline(shape, false);
		expect(placed.get(first)?.map((entry) => entry.id)).toEqual([
			"activity:apify",
		]);
		expect(placed.get(last)).toBeUndefined();
	});

	test("is placed after the text it followed, not above it", () => {
		const quiet = {
			id: "q",
			type: "tool",
			content: "",
			additional_kwargs: {
				quiet: true,
				activity: [{ id: "apify", kind: "mcp", label: "apify", state: "done" }],
			},
		};
		const turn = {
			id: "turn",
			asked: { id: "u", type: "human", content: "go" } as ChatMessage,
			steps: [
				{ id: "a", type: "ai", content: "a" },
				{ id: "t1", type: "tool", content: "", additional_kwargs: {} },
				{ id: "b", type: "ai", content: "b" },
				quiet,
			] as ChatMessage[],
		};
		const shape = shapeTurn(turn);
		expect(shape.chain.map((link) => link.kind)).toEqual([
			"text",
			"call",
			"text",
			"activity",
		]);
		expect(
			placeTimeline(shape, false)
				.get(3)
				?.map((entry) => entry.id),
		).toEqual(["activity:apify"]);
	});
});
