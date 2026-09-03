import { describe, expect, it } from "vitest";
import { MemoryRepl } from "../src/repl.ts";

// A small limit keeps the fixtures readable. Builds a list of n descending ints.
const RANGE =
	"(defun range (n) (let ((out nil)) (dotimes (i n) (setq out (cons i out))) out))";

function repl(wordLimit = 6): MemoryRepl {
	const r = new MemoryRepl({ wordLimit });
	r.eval(RANGE);
	return r;
}

describe("naming every result", () => {
	it("echoes a small result as name = value and binds the name", () => {
		const r = repl();
		expect(r.eval("(+ 1 2)")).toBe("+-1 = 3\n");
		// The name is the whole point: a later step refers to it instead of
		// retyping the value.
		expect(r.eval("(* +-1 10)")).toBe("*-1 = 30\n");
	});

	it("numbers per function and keeps counting", () => {
		const r = repl();
		expect(r.eval("(range 2)")).toBe("range-1 = (1 0)\n");
		expect(r.eval("(range 3)")).toBe("range-2 = (2 1 0)\n");
	});

	it("does not name a definition, nil or t", () => {
		const r = repl();
		expect(r.eval("(defun g (x) x)")).toBe("g\n");
		expect(r.eval("(progn nil)")).toBe("nil\n");
		expect(r.eval("(progn t)")).toBe("t\n");
	});

	it("names nothing for a program that only printed", () => {
		const r = repl();
		expect(r.eval('(princ "hi")')).toBe("hi");
	});

	it("reuses the name a setq already bound", () => {
		const r = repl();
		expect(r.eval("(setq mine (range 3))")).toBe("mine = (2 1 0)\n");
	});
});

describe("truncating a long result", () => {
	it("caps the printout and saves the whole value", () => {
		const r = repl();
		const out = r.eval("(range 20)");
		expect(out).toContain("range-1 = (19 18 17 16 15 14\n");
		expect(out).toContain("... 6 of 20 words shown, 14 below.");
		expect(out).toContain("Full value saved in range-1");
		// The binding is the complete value, not the six words printed.
		expect(r.eval("(length range-1)")).toBe("length-1 = 20\n");
	});

	it("hands back an offset that view continues from without a gap", () => {
		const r = repl();
		r.eval("(range 20)");
		expect(r.eval("(view range-1 :offset 6)")).toBe(
			"13 12 11 10 9 8\n... 6 of 20 words shown, 6 above, 8 below — next (view range-1 :offset 12)\n",
		);
	});

	it("does not name or re-truncate the output of view itself", () => {
		const r = repl();
		r.eval("(range 20)");
		r.eval("(view range-1)");
		expect(r.eval("(dump)")).not.toContain("view-1");
	});
});

describe("a program of several forms", () => {
	// The cap is per eval, not per form, so only the last is echoed — but every
	// form bound a name, and the model cannot learn the earlier ones otherwise.
	it("echoes the last result and lists the names it did not print", () => {
		const r = repl();
		expect(r.eval("(range 2) (range 3) (range 4)")).toBe(
			"(also saved: range-1, range-2)\nrange-3 = (3 2 1 0)\n",
		);
		expect(r.eval("(length range-1)")).toBe("length-1 = 2\n");
	});

	it("lists nothing when there is only one form", () => {
		const r = repl();
		expect(r.eval("(range 2)")).toBe("range-1 = (1 0)\n");
	});

	it("still reports what was bound before a later form threw", () => {
		const r = repl();
		const out = r.eval("(range 2) (no-such-fn)");
		expect(out).toContain("range-1 = (1 0)");
		expect(out).toMatch(/EvalException/);
	});
});

describe("capping side-effect output", () => {
	it("truncates a print loop and saves the text as output-N", () => {
		const r = repl();
		const out = r.eval('(dotimes (i 20) (princ i) (princ " "))');
		expect(out).toContain("0 1 2 3 4 5\n");
		expect(out).toContain("Full value saved in output-1");
		// Saved as a string, so the read-more built-ins work on it too.
		expect(r.eval('(grep output-1 "\\\\b17\\\\b" :context 1)')).toContain(
			"[[17]]",
		);
	});

	it("leaves short output exactly as it was written", () => {
		const r = repl();
		expect(r.eval('(princ "a b")')).toBe("a b");
	});
});

describe("errors", () => {
	it("still renders inline rather than throwing", () => {
		const r = repl();
		expect(r.eval("(no-such-fn)")).toMatch(/EvalException/);
	});

	it("caps a huge error message", () => {
		const r = repl();
		const out = r.eval("(error (range 40))");
		expect(out).toContain("(error message truncated)");
	});
});

describe("reset", () => {
	it("restarts the numbering along with the definitions", () => {
		const r = repl();
		expect(r.eval("(range 2)")).toBe("range-1 = (1 0)\n");
		r.reset();
		r.eval(RANGE);
		expect(r.eval("(range 2)")).toBe("range-1 = (1 0)\n");
	});
});
