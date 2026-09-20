import { describe, expect, it } from "vitest";
import { memoryRepl } from "./helpers.ts";

describe("one eval at a time", () => {
	it("does not interleave two overlapping evals", async () => {
		const r = memoryRepl();
		const first = r.evalOutput('(echo "a") (echo "a") (echo "a")');
		const second = r.evalOutput('(echo "b") (echo "b") (echo "b")');
		expect((await first).user).toBe("a\na\na\n");
		expect((await second).user).toBe("b\nb\nb\n");
	});

	it("runs a queued eval even when the one before it failed", async () => {
		const r = memoryRepl();
		const failed = r.evalOutput("(car 1 2 3)");
		const after = r.evalOutput("(echo (+ 1 2))");
		expect((await failed).model).toContain("EvalException");
		expect((await after).user).toBe("3\n");
	});
});
