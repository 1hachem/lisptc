import { describe, expect, it, test, vi } from "vitest";
import type { ChatMessage } from "../src/lib/chat.tsx";
import { toolEnvelope } from "../src/lib/tool-result.ts";

vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: vi.fn() }));

const { toolResult } = await import("../src/lib/chat.tsx");

const modelRead = JSON.stringify({
	source: "lisp-repl",
	output: '(("playwright" 7 :unloaded))',
	error: false,
});

describe("toolEnvelope", () => {
	it("unwraps a result whatever its source, keeping its error flag", () => {
		const stopped = JSON.stringify({
			type: "tool_result",
			source: "lisp-check",
			error: true,
			output: "line 1: car: expected 1 argument, got 0",
		});
		expect(toolEnvelope(stopped)).toEqual({
			output: "line 1: car: expected 1 argument, got 0",
			error: true,
		});
		const ran = JSON.stringify({
			type: "tool_result",
			source: "lisp-repl",
			error: false,
			output: "3",
		});
		expect(toolEnvelope(ran)).toEqual({ output: "3", error: false });
	});

	it("leaves text that is no tool result alone", () => {
		expect(toolEnvelope("plain output")).toBeUndefined();
		expect(toolEnvelope('{"type":"other"}')).toBeUndefined();
	});
});

describe("what a step shows the person", () => {
	test("is nothing when it echoed nothing, whatever the model read", () => {
		const step: ChatMessage = { type: "tool", content: modelRead };

		expect(toolResult(step)).toEqual({ output: "", error: false });
	});

	test("is its echo, never what the model read", () => {
		const step: ChatMessage = {
			type: "tool",
			content: modelRead,
			additional_kwargs: { display: "two servers" },
		};

		expect(toolResult(step).output).toBe("two servers");
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
