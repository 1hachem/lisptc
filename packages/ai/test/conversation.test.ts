import { describe, expect, it } from "vitest";
import { checkResultContent, conversationOf } from "../src/repl.ts";

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

	it("exposes those problems on its conversation entry", () => {
		const conversation = conversationOf([
			{ role: "assistant", content: "(echo 1)\n(echo (totl 2))" },
			{ role: "tool", content: checkResultContent("not run", problems) },
		]);
		expect(conversation).toEqual([
			{ role: "assistant", content: "(echo 1)\n(echo (totl 2))" },
			{
				role: "tool",
				content: checkResultContent("not run", problems),
				problems,
			},
		]);
	});
});
