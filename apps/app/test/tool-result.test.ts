import { describe, expect, it } from "vitest";
import { toolEnvelope } from "../src/lib/tool-result.ts";

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
