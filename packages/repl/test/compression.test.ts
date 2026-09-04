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

describe("reporting every result", () => {
	it("reports a small result as its value and binds the name", () => {
		const r = repl();
		expect(r.eval("(+ 1 2)")).toBe("+-1: 3\n");
		// The name is the whole point: a later step refers to it instead of
		// retyping the value.
		expect(r.eval("(* +-1 10)")).toBe("*-1: 30\n");
	});

	it("describes a long result instead of printing it", () => {
		const r = repl();
		// Nothing of the value itself reaches the caller — that is what stops it
		// being copied back by hand — but the binding holds all of it.
		expect(r.eval("(range 20)")).toBe("range-1: list of 20 items, 20 words\n");
		expect(r.eval("(length range-1)")).toBe("length-1: 20\n");
	});

	it("numbers per function and keeps counting", () => {
		const r = repl();
		expect(r.eval("(range 2)")).toBe("range-1: (1 0)\n");
		expect(r.eval("(range 3)")).toBe("range-2: (2 1 0)\n");
	});

	it("reports a definition by what it is, and nil/t as themselves", () => {
		const r = repl();
		expect(r.eval("(defun g (x) x)")).toBe("g: function\n");
		expect(r.eval("(progn nil)")).toBe("nil\n");
		expect(r.eval("(progn t)")).toBe("t\n");
	});

	it("reports nothing for a program that only echoed", () => {
		const r = repl();
		expect(r.eval('(echo "hi")')).toBe("hi\n");
	});

	it("reuses the name a setq already bound", () => {
		const r = repl();
		expect(r.eval("(setq mine (range 3))")).toBe("mine: (2 1 0)\n");
	});

	// One line per form, in order: the model wrote several forms, so it gets
	// several reports and can refer to any of them.
	it("reports each form of a multi-form program", () => {
		const r = repl();
		expect(r.eval("(range 2) (range 3)")).toBe(
			"range-1: (1 0)\nrange-2: (2 1 0)\n",
		);
		expect(r.eval("(length range-1)")).toBe("length-1: 2\n");
	});

	// The literal argument is what makes the misspelling a call rather than a
	// turn of phrase — a bare `(no-such-fn)` is read as prose (see src/prose.ts).
	it("still reports what was bound before a later form threw", () => {
		const r = repl();
		const out = r.eval('(range 2) (no-such-fn "x")');
		expect(out).toContain("range-1: (1 0)");
		expect(out).toMatch(/EvalException/);
	});
});

/*
 * A slice is asked for in order to be read, so `(head x 5)` on its own prints
 * it. The alternative cost the agent a whole step: a report saying `head-1:
 * list of 5 items` told it only what it already knew, and it had to write
 * `(echo head-1)` to see what it had come for.
 */
describe("a slice taken as a step of its own", () => {
	it("prints the slice rather than describing it", () => {
		const r = repl();
		r.eval("(range 20)");
		expect(r.eval("(head range-1 3)")).toBe("(19 18 17)\n");
		expect(r.eval("(tail range-1 2)")).toBe("(1 0)\n");
	});

	it("prints a text slice word-wise", () => {
		const r = repl();
		expect(r.eval('(head "the quick brown fox jumps" 3)')).toBe(
			"the quick brown\n",
		);
	});

	it("mints no name for it — the source already has one", () => {
		const r = repl();
		r.eval("(range 20)");
		r.eval("(head range-1 3)");
		expect(r.eval("(dump)")).not.toContain("head-1");
	});

	// Only the bare form prints: a slice handed to another function is that
	// function's argument, and printing it would leak data the step never
	// asked to see.
	it("stays silent inside another form", () => {
		const r = repl();
		r.eval("(range 20)");
		expect(r.eval("(length (head range-1 3))")).toBe("length-1: 3\n");
	});

	// The value comes back as well as being printed, so the agent can keep it.
	it("is still a value a setq can bind", () => {
		const r = repl();
		r.eval("(range 20)");
		expect(r.eval("(setq top (head range-1 3))")).toBe("top: (19 18 17)\n");
		expect(r.eval("(length top)")).toBe("length-1: 3\n");
	});

	// The step's word budget bounds it like any other output: what the model
	// sees stops, with the offset to read on from.
	it("is capped against the step's budget", () => {
		const r = repl();
		r.eval("(range 20)");
		const { model, user } = r.evalOutput("(head range-1 12)");
		expect(model).toContain("6 of 12 words shown");
		expect(user).not.toContain("words shown");
	});
});

describe("extracting, then echoing", () => {
	// The pattern the whole design is for: pull what you need into a named
	// value, then print a rendering of THAT — never read data off a printout.
	it("names what grep extracted so the next form can use it", () => {
		const r = repl();
		expect(r.eval('(grep "see https://x.dev/a now" "https?://[^ ]+")')).toBe(
			'grep-1: ("https://x.dev/a")\n',
		);
		expect(r.eval("(echo (car grep-1))")).toBe("https://x.dev/a\n");
	});
});

describe("capping echo output", () => {
	// The budget is per step, so a loop of small echoes spends it as surely as
	// one large echo — and the model is told how much it did not see.
	it("stops a long echo loop for the model and says how much it dropped", () => {
		const r = repl();
		const out = r.eval("(dotimes (i 20) (echo i))");
		expect(out).toContain("0\n1\n2\n3\n4\n5\n");
		expect(out).toContain("14 more words of echo output not shown to you");
		expect(out).not.toContain("7\n");
	});

	it("hands the human the whole output while capping the model's copy", () => {
		const r = repl();
		const { model, user } = r.evalOutput("(dotimes (i 20) (echo i))");
		expect(model).toContain("not shown to you");
		expect(user).not.toContain("not shown to you");
		expect(user).toContain("19\n");
		// Both end with the same report line for the form itself.
		expect(model.endsWith("nil\n")).toBe(true);
		expect(user.endsWith("nil\n")).toBe(true);
	});

	it("leaves short output exactly as it was written", () => {
		const r = repl();
		expect(r.eval('(echo "a b")')).toBe("a b\n");
	});

	it("hands back an offset that echo continues from without a gap", () => {
		const r = repl();
		r.eval("(range 20)");
		expect(r.eval("(echo range-1 :offset 6)")).toBe(
			"13 12 11 10 9 8\n... 6 of 20 words shown, 6 above, 8 below — read on with (echo range-1 :offset 12)\n",
		);
	});

	it("does not name or re-truncate the output of echo itself", () => {
		const r = repl();
		r.eval("(range 20)");
		r.eval("(echo range-1)");
		expect(r.eval("(dump)")).not.toContain("echo-1");
	});
});

describe("errors", () => {
	it("still renders inline rather than throwing", () => {
		const r = repl();
		expect(r.eval('(no-such-fn "x")')).toMatch(/EvalException/);
	});

	it("caps a huge error message", () => {
		const r = repl();
		const out = r.eval("(error (range 40))");
		expect(out).toContain("(error message truncated)");
	});

	// An error inside a loop body unwinds through a closure that captures
	// itself; rendering the trace used to recurse until the stack gave out.
	it("renders an error raised inside a multi-form loop body", () => {
		const r = repl();
		expect(r.eval("(dotimes (i 20) (no-such-fn i) (no-such-fn 2))")).toMatch(
			/EvalException/,
		);
	});
});

describe("reset", () => {
	it("restarts the numbering along with the definitions", () => {
		const r = repl();
		expect(r.eval("(range 2)")).toBe("range-1: (1 0)\n");
		r.reset();
		r.eval(RANGE);
		expect(r.eval("(range 2)")).toBe("range-1: (1 0)\n");
	});
});
