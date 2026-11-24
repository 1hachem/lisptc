import { describe, expect, it } from "vitest";
import { forkChoices } from "../src/lib/fork-choices.ts";

describe("the messages a chat can be forked at", () => {
	it("shortens a long message and skips one with no id yet", () => {
		const choices = forkChoices([
			{ type: "human", content: "still streaming" },
			{ id: "h1", type: "human", content: "x".repeat(200) },
		]);
		expect(choices).toHaveLength(1);
		expect(choices[0]?.name.endsWith("…")).toBe(true);
		expect(choices[0]?.name.length).toBeLessThan(100);
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
