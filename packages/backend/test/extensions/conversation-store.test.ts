import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel.js";
import { ConvexConversationStore } from "../../src/conversation-store.ts";

const CHAT = "chat" as Id<"chats">;

function storeOf(rows: { type: string; content: string }[]) {
	const asked: unknown[] = [];
	const store = new ConvexConversationStore(CHAT, () => ({
		query: (async (_ref: unknown, args: unknown) => {
			asked.push(args);
			return rows;
		}) as never,
	}));
	return { store, asked };
}

describe("the conversation a chat has stored", () => {
	it("reads this chat's rows and names each by its role", async () => {
		const { store, asked } = storeOf([
			{ type: "human", content: "add them" },
			{ type: "ai", content: "(echo (+ 1 2))" },
			{ type: "system", content: "approved" },
		]);
		expect(await store.stored()).toEqual([
			{ role: "user", content: "add them" },
			{ role: "assistant", content: "(echo (+ 1 2))" },
			{ role: "system", content: "approved" },
		]);
		expect(asked).toEqual([{ chatId: CHAT }]);
	});

	it("unwraps a tool result to its output, keeping a stopped step's problems", async () => {
		const problems = [{ line: 1, message: "car: expected 1 argument, got 0" }];
		const { store } = storeOf([
			{
				type: "tool",
				content: JSON.stringify({
					type: "tool_result",
					source: "lisp-repl",
					error: false,
					output: "3",
				}),
			},
			{
				type: "tool",
				content: JSON.stringify({
					type: "tool_result",
					source: "lisp-check",
					error: true,
					output: "not run",
					problems,
				}),
			},
			{ type: "tool", content: "plain text" },
		]);
		expect(await store.stored()).toEqual([
			{ role: "tool", content: "3" },
			{ role: "tool", content: "not run", problems },
			{ role: "tool", content: "plain text" },
		]);
	});
});
