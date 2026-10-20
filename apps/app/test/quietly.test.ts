import { describe, expect, test } from "vitest";
import { quietly } from "../src/lib/quietly.ts";

describe("sending a message quietly", () => {
	test("wraps each form in quietly and leaves the text around them", () => {
		expect(quietly('note (setq x 1) then (echo "hi")')).toBe(
			'note (quietly (setq x 1)) then (quietly (echo "hi"))',
		);
	});

	test("keeps a quote on the form it belongs to", () => {
		expect(quietly("see '(a b)")).toBe("see (quietly '(a b))");
	});

	test("leaves a parenthetical aside as prose", () => {
		expect(quietly("hi (Best for quick tests) (+ 1 2)")).toBe(
			"hi (Best for quick tests) (quietly (+ 1 2))",
		);
	});

	test("changes nothing in a message without forms", () => {
		expect(quietly("just a question")).toBe("just a question");
	});
});
