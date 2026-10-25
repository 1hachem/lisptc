import { describe, expect, test, vi } from "vitest";

vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: () => {} }));
vi.mock("../src/lib/api.ts", () => ({ apiHeaders: async () => ({}) }));

import type { ChatMessage } from "../src/lib/chat.tsx";
import {
	applyWatched,
	readSse,
	shownMessages,
	UNWATCHED,
	type Watched,
} from "../src/lib/watch.ts";

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function watch(...chunks: string[]): Watched {
	let watched = UNWATCHED;
	let buffer = "";
	for (const chunk of chunks) {
		const { events, rest } = readSse(buffer + chunk);
		buffer = rest;
		watched = events.reduce(applyWatched, watched);
	}
	return watched;
}

const human: ChatMessage = { id: "h", type: "human", content: "hi" };
const ask: ChatMessage = { id: "ask", type: "tool", content: "r is waiting" };

describe("what the watch stream shows", () => {
	test("reads an event split across chunks", () => {
		const whole = sse("values", { messages: [human] });
		const watched = watch(whole.slice(0, 9), whole.slice(9));
		expect(watched.snapshot).toEqual([human]);
	});

	test("follows a turn it did not start through its statuses", () => {
		const watched = watch(
			sse("status", { status: "idle" }),
			sse("status", { status: "running" }),
			sse("values", { messages: [human] }),
		);
		expect(watched.status).toBe("running");
		expect(shownMessages(watched)).toEqual([human]);
	});

	test("grows the reply from its deltas", () => {
		const watched = watch(
			sse("values", { messages: [human] }),
			sse("messages", [{ id: "a", type: "ai", content: "he" }, {}]),
			sse("messages", [{ id: "a", type: "ai", content: "llo" }, {}]),
		);
		expect(shownMessages(watched).at(-1)).toMatchObject({ content: "hello" });
	});

	test("keeps a relayed ask where it arrived after the turn moves on", () => {
		const step: ChatMessage = { id: "s", type: "ai", content: "(+ 1 2)" };
		const watched = watch(
			sse("values", { messages: [human] }),
			sse("relayed", ask),
			sse("values", { messages: [human, step] }),
		);
		expect(shownMessages(watched)).toEqual([human, ask, step]);
	});

	test("shows a relayed message once the turn carries it too", () => {
		const watched = watch(
			sse("relayed", ask),
			sse("values", { messages: [human, ask] }),
		);
		expect(shownMessages(watched)).toEqual([human, ask]);
	});

	test("carries the failure an errored thread reports", () => {
		const watched = watch(
			sse("status", { status: "errored", failure: "boom" }),
		);
		expect(watched).toMatchObject({ status: "errored", failure: "boom" });
	});
});
