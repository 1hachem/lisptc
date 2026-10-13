import { describe, expect, it } from "vitest";
import { forkChoices } from "../src/lib/fork-choices.ts";

describe("the messages a chat can be forked at", () => {
	it("lists them newest first, by who said what", () => {
		const choices = forkChoices([
			{ id: "h1", type: "human", content: "define a square" },
			{ id: "a1", type: "ai", content: "(defun sq (x)\n  (* x x))" },
			{ id: "t1", type: "tool", content: "sq" },
		]);
		expect(choices.map((c) => c.id)).toEqual(["t1", "a1", "h1"]);
		expect(choices.map((c) => c.name)).toEqual([
			"REPL: sq",
			"Agent: (defun sq (x) (* x x))",
			"You: define a square",
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
});
