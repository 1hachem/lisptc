import { describe, expect, it } from "vitest";
import { forkChoices } from "../src/lib/fork-choices.ts";

describe("the messages a chat can be forked at", () => {
	it("lists them in the order they were said, by who said what", () => {
		const choices = forkChoices([
			{ id: "h1", type: "human", content: "define a square" },
			{ id: "a1", type: "ai", content: "(defun sq (x)\n  (* x x))" },
			{ id: "t1", type: "tool", content: "sq" },
		]);
		expect(choices.map((c) => c.id)).toEqual(["h1", "a1", "t1"]);
		expect(choices.map((c) => c.name)).toEqual([
			"You: define a square",
			"Agent: (defun sq (x) (* x x))",
			"REPL: sq",
		]);
	});

	it("shortens a long message and skips one with no id yet", () => {
		const choices = forkChoices([
			{ type: "human", content: "still streaming" },
			{ id: "h1", type: "human", content: "x".repeat(200) },
		]);
		expect(choices).toHaveLength(1);
		expect(choices[0]?.name.endsWith("…")).toBe(true);
		expect(choices[0]?.name.length).toBeLessThan(100);
	});

	it("leaves out the greeting, which is never stored", () => {
		const choices = forkChoices([
			{ id: "greeting", type: "ai", content: "hello" },
			{ id: "h1", type: "human", content: "hi" },
		]);
		expect(choices.map((c) => c.id)).toEqual(["h1"]);
	});

	it("leaves out the journal's entries, so a fork cuts at a message", () => {
		const choices = forkChoices([
			{ id: "a1", type: "ai", content: "(work)" },
			{
				id: "e1",
				type: "entry",
				content: "",
				additional_kwargs: { kind: "intent", value: {} },
			},
			{ id: "t1", type: "tool", content: "done" },
		]);
		expect(choices.map((c) => c.id)).toEqual(["a1", "t1"]);
	});
});
