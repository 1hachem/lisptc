import { describe, expect, it } from "vitest";
import { llmSlot } from "../src/observe.ts";

describe("llmSlot", () => {
	it("is the slot named llm", () => {
		expect(llmSlot).toEqual({ name: "llm" });
	});
});
