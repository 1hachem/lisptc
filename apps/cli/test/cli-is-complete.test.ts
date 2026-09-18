import { describe, expect, it } from "vitest";
import { isComplete } from "../src/cli.ts";

describe("isComplete (attach-mode line buffering)", () => {
	it("is false for the opening line of a multi-line form", () => {
		expect(isComplete("(try\n")).toBe(false);
	});

	it("is false while a nested form is still open", () => {
		expect(isComplete("(try\n  (+ 1 2)\n")).toBe(false);
	});

	it("is true once a multi-line form is fully closed", () => {
		expect(isComplete("(try\n  (+ 1 2)\n  (catch (e) 3))\n")).toBe(true);
	});

	it("is true for a single complete form", () => {
		expect(isComplete("(+ 1 2)\n")).toBe(true);
	});

	it("is true for a genuine parse error, so it can render inline", () => {
		expect(isComplete(")\n")).toBe(true);
	});
});
