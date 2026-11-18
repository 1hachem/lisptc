import type { ChatMessage } from "@repo/components";
import { describe, expect, test, vi } from "vitest";

vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: vi.fn() }));

const { toolResult } = await import("../src/lib/chat.tsx");

const modelRead = JSON.stringify({
	source: "lisp-repl",
	output: '(("playwright" 7 :unloaded))',
	error: false,
});

describe("what a step shows the person", () => {
	test("is nothing when it echoed nothing, whatever the model read", () => {
		const step: ChatMessage = { type: "tool", content: modelRead };

		expect(toolResult(step)).toEqual({ output: "", error: false });
	});

	test("is an error once it failed, with its content already dropped", () => {
		const step: ChatMessage = {
			type: "tool",
			content: "",
			additional_kwargs: { display: "REPL error: boom", failed: true },
		};

		expect(toolResult(step)).toEqual({
			output: "REPL error: boom",
			error: true,
		});
	});
});
