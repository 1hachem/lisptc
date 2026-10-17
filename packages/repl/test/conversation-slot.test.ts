import { conversationSlot } from "@repo/interpreter/conversation";
import { describe, expect, it } from "vitest";
import { AgentRepl, MemoryRepl } from "../src/repl.ts";

describe("the conversation an agent repl hands over", () => {
	const entries = [
		{ role: "user" as const, content: "add them" },
		{ role: "assistant" as const, content: "(echo (car))" },
		{
			role: "tool" as const,
			content: "not run",
			problems: [{ line: 1, message: "car: expected 1 argument, got 0" }],
		},
	];

	it("fills the slot with the entries it was last given", () => {
		const repl = new AgentRepl({ extensions: [] });
		const source = repl.hooks.filled(conversationSlot);
		expect(source?.entries()).toEqual([]);
		repl.setConversation(entries);
		expect(source?.entries()).toEqual(entries);
	});

	it("keeps the globals the model reads in step with the slot", async () => {
		const repl = new AgentRepl({ extensions: [] });
		repl.setConversation(entries);
		const echoed = (code: string) => repl.evalOutput(code).then((o) => o.user);
		expect(await echoed("(echo (length conversation))")).toBe("3\n");
		expect(await echoed("(echo (car user-messages))")).toBe("add them\n");
		expect(await echoed("(echo (car assistant-messages))")).toBe(
			"(echo (car))\n",
		);
	});

	it("is not handed over by a repl that is not an agent's", () => {
		expect(
			new MemoryRepl({ extensions: [] }).hooks.filled(conversationSlot),
		).toBeUndefined();
	});
});
