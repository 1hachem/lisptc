import { describe, expect, it } from "vitest";
import { checkResultContent } from "../src/repl.ts";

describe("a stopped step in the conversation", () => {
	const problems = [{ line: 2, message: "totl is not defined" }];

	it("keeps its problems in the check result it is stored as", () => {
		expect(JSON.parse(checkResultContent("not run", problems))).toEqual({
			type: "tool_result",
			source: "lisp-check",
			error: true,
			output: "not run",
			problems,
		});
		expect(JSON.parse(checkResultContent("not run"))).not.toHaveProperty(
			"problems",
		);
	});
});
