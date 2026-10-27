import { noAnnotations } from "@repo/interpreter/session";
import { describe, expect, test } from "vitest";
import { type ToolOutcome, toolMessage } from "../src/tool-message.ts";

function outcome(output: string, display: string): ToolOutcome {
	return {
		output,
		display,
		error: false,
		failed: false,
		results: [],
		annotations: noAnnotations(),
	};
}

describe("a tool message", () => {
	test("records no display when the person was shown nothing", () => {
		const message = toolMessage(
			outcome('(("playwright" 7 :unloaded))', ""),
			"t1",
		);

		expect(message.additional_kwargs?.display).toBeUndefined();
		expect(message.content).toContain("playwright");
	});

	test("records the display even when it reads the same as the model's output", () => {
		const message = toolMessage(outcome("hello", "hello"), "t1");

		expect(message.additional_kwargs?.display).toBe("hello");
	});
});
