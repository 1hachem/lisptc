import { describe, expect, test } from "vitest";
import { answerOf, openQuestion, questionText } from "../src/lib/question.ts";

const question = {
	id: "q1",
	prompt: "which one?",
	choices: ["A", "B", "C"],
	multi: false,
};

const asked = {
	type: "tool",
	additional_kwargs: { question },
};

describe("the open question", () => {
	test("is the question on the last tool message", () => {
		expect(
			openQuestion([{ type: "human" }, { type: "ai" }, asked, { type: "ai" }]),
		).toEqual(question);
	});

	test("is closed once a human message follows it", () => {
		expect(
			openQuestion([asked, { type: "ai" }, { type: "human" }]),
		).toBeUndefined();
	});

	test("is the newest one when two were asked", () => {
		const later = { ...question, id: "q2" };
		expect(
			openQuestion([
				asked,
				{ type: "tool", additional_kwargs: { question: later } },
			]),
		).toEqual(later);
	});

	test("is absent when no tool message carries one", () => {
		expect(
			openQuestion([{ type: "tool", additional_kwargs: {} }, { type: "ai" }]),
		).toBeUndefined();
	});

	test("ignores a malformed question", () => {
		expect(
			openQuestion([
				{ type: "tool", additional_kwargs: { question: { id: "q" } } },
			]),
		).toBeUndefined();
	});
});

describe("the answer to a question", () => {
	test("is the chosen label", () => {
		expect(answerOf(question, [1])).toBe("B");
	});

	test("joins several choices in the order of the list", () => {
		expect(answerOf(question, [0, 2])).toBe("A, C");
	});
});

describe("a question as text", () => {
	test("reads the prompt and every choice", () => {
		expect(questionText(question)).toBe("which one?\npick one: A · B · C");
	});

	test("says when several may be picked", () => {
		expect(questionText({ ...question, multi: true })).toBe(
			"which one?\npick several: A · B · C",
		);
	});
});
