import { describe, expect, it } from "vitest";
import { replResultContent } from "../src/repl.ts";

describe("what the model is handed", () => {
	it("is the output in an envelope, and nothing a step annotated", () => {
		expect(JSON.parse(replResultContent("out", true))).toEqual({
			type: "tool_result",
			source: "lisp-repl",
			error: true,
			output: "out",
		});
	});
});
