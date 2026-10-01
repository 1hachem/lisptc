import { describe, expect, it } from "vitest";
import { tone } from "../src/render.ts";

describe("tone", () => {
	it("is an error when the step threw", () => {
		expect(tone({ display: "", error: true, failed: false })).toBe("error");
	});

	it("warns when the step ran but reported a failure", () => {
		expect(tone({ display: "", error: false, failed: true })).toBe("warning");
	});

	it("prefers the error over the failure", () => {
		expect(tone({ display: "", error: true, failed: true })).toBe("error");
	});

	it("is a success otherwise", () => {
		expect(tone({ display: "42", error: false, failed: false })).toBe(
			"success",
		);
	});
});
