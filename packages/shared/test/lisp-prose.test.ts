import { describe, expect, it } from "vitest";
import { looksLikeParenthesizedProse } from "../src/lisp-prose.ts";

describe("parenthesized prose", () => {
	it.each([
		"(3)",
		"(10 MB)",
		"(one, two, three)",
		"(2 agents, 10 MB storage, 100 credits)",
		"(TODO: fix this)",
		"(Best for quick tests)",
		"(A/B test)",
		"(see https://example.com)",
		"(Lisp (the language) is old)",
		"(🙂)",
		'("quoted")',
	])("recognizes %s", (source) => {
		expect(looksLikeParenthesizedProse(source)).toBe(true);
	});

	it.each([
		"(see below)",
		"(for example)",
		"(echo 1)",
		"(+ 1 2)",
		"(server/tool)",
		"(step_two)",
		'(server/tool :key "value")',
		'(navigate :key "value")',
		'(steps "one, two, three")',
		"(fetch '(one two))",
		"(fetch `items)",
		"(fetch ,items)",
	])("leaves %s as code-shaped", (source) => {
		expect(looksLikeParenthesizedProse(source)).toBe(false);
	});
});
