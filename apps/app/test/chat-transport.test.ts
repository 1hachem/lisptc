import { FetchStreamTransport } from "@langchain/langgraph-sdk/react";
import { describe, expect, test } from "vitest";

async function bodyOf(payload: Record<string, unknown>): Promise<unknown> {
	let sent: unknown;
	const transport = new FetchStreamTransport({
		apiUrl: "http://api.test/api/chat",
		fetch: (_url: string, init: RequestInit) => {
			sent = JSON.parse(String(init.body));
			return Promise.resolve(
				new Response(new ReadableStream(), {
					headers: { "content-type": "text/event-stream" },
				}),
			);
		},
	});
	await transport.stream({
		input: payload,
		context: undefined,
		command: undefined,
		signal: new AbortController().signal,
	} as Parameters<typeof transport.stream>[0]);
	return sent;
}

describe("what the streaming transport posts", () => {
	test("wraps a turn in an input envelope the api parses", async () => {
		expect(await bodyOf({ chatId: "chat-1", message: "hello" })).toEqual({
			input: { chatId: "chat-1", message: "hello" },
		});
	});
});
