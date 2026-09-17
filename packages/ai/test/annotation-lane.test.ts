import { describe, expect, it } from "vitest";
import { replResultContent } from "../src/repl.ts";

describe("what the model is handed", () => {
	it("carries what the step annotated beside the output, not inside it", () => {
		const content = replResultContent("+-1: 2\n", false, {
			memories: [{ key: "joins", body: "string-join takes the list FIRST" }],
		});
		const parsed = JSON.parse(content);

		expect(parsed.output).toBe("+-1: 2\n");
		expect(parsed.output).not.toContain("string-join");
		expect(parsed.memories).toEqual([
			{ key: "joins", body: "string-join takes the list FIRST" },
		]);
	});

	it("says nothing about a lane the step left empty", () => {
		const parsed = JSON.parse(replResultContent("+-1: 2\n", false, {}));

		expect(parsed).not.toHaveProperty("memories");
	});

	it("leaves the envelope alone when nothing is annotated at all", () => {
		const parsed = JSON.parse(replResultContent("out", true));

		expect(parsed).toEqual({
			type: "tool_result",
			source: "lisp-repl",
			error: true,
			output: "out",
		});
	});
});
