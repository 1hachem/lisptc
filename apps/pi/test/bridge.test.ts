import { describe, expect, it } from "vitest";
import {
	capped,
	conversationVars,
	messageText,
	stepCode,
	turnsFrom,
} from "../src/bridge.ts";

describe("messageText", () => {
	it("takes a string content as it is", () => {
		expect(messageText("(+ 1 2)")).toBe("(+ 1 2)");
	});

	it("joins the text parts and drops the rest", () => {
		expect(
			messageText([
				{ type: "thinking", thinking: "plan" },
				{ type: "text", text: "(+ 1 " },
				{ type: "toolCall", name: "read" },
				{ type: "text", text: "2)" },
			]),
		).toBe("(+ 1 2)");
	});

	it("is empty for content that carries no text", () => {
		expect(messageText(undefined)).toBe("");
		expect(messageText([{ type: "thinking", thinking: "plan" }])).toBe("");
	});
});

describe("stepCode", () => {
	it("keeps prose around a form, because the reader skips it", () => {
		expect(stepCode("Let me add them. (+ 1 2)")).toBe(
			"Let me add them. (+ 1 2)",
		);
	});

	it("unwraps a fenced block", () => {
		expect(stepCode("```lisp\n(+ 1 2)\n```")).toBe("(+ 1 2)");
	});

	it("is undefined for prose alone, which ends the loop", () => {
		expect(stepCode("the sum is 3")).toBeUndefined();
		expect(stepCode("")).toBeUndefined();
	});

	it("is undefined when a bare value sits outside a form", () => {
		expect(stepCode("result-1")).toBeUndefined();
	});
});

describe("capped", () => {
	it("stops on the step that reaches the cap", () => {
		expect(capped(0, 3)).toBe(false);
		expect(capped(1, 3)).toBe(false);
		expect(capped(2, 3)).toBe(true);
	});
});

describe("conversationVars", () => {
	it("mirrors the transcript into the three read-only globals", () => {
		const vars = conversationVars([
			{ role: "user", content: "add them" },
			{ role: "assistant", content: "(+ 1 2)" },
			{ role: "user", content: "again" },
		]);
		expect(vars["user-messages"]).toEqual(["add them", "again"]);
		expect(vars["assistant-messages"]).toEqual(["(+ 1 2)"]);
		expect(vars.conversation).toEqual([
			{ role: "user", content: "add them" },
			{ role: "assistant", content: "(+ 1 2)" },
			{ role: "user", content: "again" },
		]);
	});
});

describe("turnsFrom", () => {
	it("keeps the two roles the globals are built from", () => {
		expect(
			turnsFrom([
				{ role: "system", content: "prompt" },
				{ role: "user", content: "add them" },
				{ role: "assistant", content: [{ type: "text", text: "(+ 1 2)" }] },
				{ role: "custom", content: "result" },
				null,
			]),
		).toEqual([
			{ role: "user", content: "add them" },
			{ role: "assistant", content: "(+ 1 2)" },
		]);
	});
});
