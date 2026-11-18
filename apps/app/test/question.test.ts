import { describe, expect, test } from "vitest";
import { openQuestion, questionText } from "../src/lib/question.ts";

const question = {
	id: "q1",
	prompt: "which one?",
	choices: ["A", "B", "C"],
	multi: false,
};

const asked = {
	type: "entry",
	additional_kwargs: { kind: "question", value: question },
};

describe("the open question", () => {
	test("is the newest one when two were asked", () => {
		const later = { ...question, id: "q2" };
		expect(
			openQuestion([
				asked,
				{
					type: "entry",
					additional_kwargs: { kind: "question", value: later },
				},
			]),
		).toEqual(later);
	});

	test("is absent when the turn recorded none", () => {
		expect(
			openQuestion([{ type: "tool", additional_kwargs: {} }, { type: "ai" }]),
		).toBeUndefined();
	});
});

describe("a question as text", () => {
	test("reads apart when several may be picked", () => {
		expect(questionText({ ...question, multi: true })).not.toBe(
			questionText(question),
		);
	});
});
