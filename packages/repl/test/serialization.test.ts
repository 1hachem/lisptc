import { describe, expect, it } from "vitest";
import { MemoryRepl } from "../src/repl.ts";

describe("one eval at a time", () => {
	it("does not interleave two overlapping evals", async () => {
		const r = new MemoryRepl();
		await r.eval(
			"(defun range (n) (let ((out nil)) (dotimes (i n) (setq out (cons i out))) out))",
		);
		const first = r.eval('(echo "a") (echo "a") (echo "a")');
		const second = r.eval('(echo "b") (echo "b") (echo "b")');
		expect(await first).toBe("a\na\na\n");
		expect(await second).toBe("b\nb\nb\n");
	});

	it("keeps each step's result names in its own report", async () => {
		const r = new MemoryRepl();
		const first = r.eval("(list 1 2 3)");
		const second = r.eval("(list 4 5 6)");
		expect(await first).toBe("list-1: (1 2 3)\n");
		expect(await second).toBe("list-2: (4 5 6)\n");
	});

	it("runs a queued eval even when the one before it failed", async () => {
		const r = new MemoryRepl();
		const failed = r.eval("(car 1 2 3)");
		const after = r.eval("(+ 1 2)");
		expect(await failed).toContain("EvalException");
		expect(await after).toBe("+-1: 3\n");
	});
});
