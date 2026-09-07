import { describe, expect, it } from "vitest";
import { MemoryRepl } from "../src/repl.ts";

const RANGE =
	"(defun range (n) (let ((out nil)) (dotimes (i n) (setq out (cons i out))) out))";

async function repl(wordLimit = 6): Promise<MemoryRepl> {
	const r = new MemoryRepl({ wordLimit });
	await r.eval(RANGE);
	return r;
}

describe("reporting every result", () => {
	it("reports a small result as its value and binds the name", async () => {
		const r = await repl();
		expect(await r.eval("(+ 1 2)")).toBe("+-1: 3\n");
		expect(await r.eval("(* +-1 10)")).toBe("*-1: 30\n");
	});

	it("describes a long result instead of printing it", async () => {
		const r = await repl();
		expect(await r.eval("(range 20)")).toBe(
			"range-1: list of 20 items, 20 words\n",
		);
		expect(await r.eval("(length range-1)")).toBe("length-1: 20\n");
	});

	it("numbers per function and keeps counting", async () => {
		const r = await repl();
		expect(await r.eval("(range 2)")).toBe("range-1: (1 0)\n");
		expect(await r.eval("(range 3)")).toBe("range-2: (2 1 0)\n");
	});

	it("reports a definition by what it is, and nil/t as themselves", async () => {
		const r = await repl();
		expect(await r.eval("(defun g (x) x)")).toBe("g: function\n");
		expect(await r.eval("(progn nil)")).toBe("nil\n");
		expect(await r.eval("(progn t)")).toBe("t\n");
	});

	it("reports nothing for a program that only echoed", async () => {
		const r = await repl();
		expect(await r.eval('(echo "hi")')).toBe("hi\n");
	});

	it("reuses the name a setq already bound", async () => {
		const r = await repl();
		expect(await r.eval("(setq mine (range 3))")).toBe("mine: (2 1 0)\n");
	});

	it("reports each form of a multi-form program", async () => {
		const r = await repl();
		expect(await r.eval("(range 2) (range 3)")).toBe(
			"range-1: (1 0)\nrange-2: (2 1 0)\n",
		);
		expect(await r.eval("(length range-1)")).toBe("length-1: 2\n");
	});

	it("still reports what was bound before a later form threw", async () => {
		const r = await repl();
		const out = await r.eval('(range 2) (no-such-fn "x")');
		expect(out).toContain("range-1: (1 0)");
		expect(out).toMatch(/EvalException/);
	});
});

describe("a slice taken as a step of its own", () => {
	it("prints the slice rather than describing it", async () => {
		const r = await repl();
		await r.eval("(range 20)");
		expect(await r.eval("(head range-1 3)")).toBe("(19 18 17)\n");
		expect(await r.eval("(tail range-1 2)")).toBe("(1 0)\n");
	});

	it("prints a text slice word-wise", async () => {
		const r = await repl();
		expect(await r.eval('(head "the quick brown fox jumps" 3)')).toBe(
			"the quick brown\n",
		);
	});

	it("mints no name for it — the source already has one", async () => {
		const r = await repl();
		await r.eval("(range 20)");
		await r.eval("(head range-1 3)");
		expect(await r.eval("(dump)")).not.toContain("head-1");
	});

	it("stays silent inside another form", async () => {
		const r = await repl();
		await r.eval("(range 20)");
		expect(await r.eval("(length (head range-1 3))")).toBe("length-1: 3\n");
	});

	it("is still a value a setq can bind", async () => {
		const r = await repl();
		await r.eval("(range 20)");
		expect(await r.eval("(setq top (head range-1 3))")).toBe(
			"top: (19 18 17)\n",
		);
		expect(await r.eval("(length top)")).toBe("length-1: 3\n");
	});

	it("is capped against the step's budget", async () => {
		const r = await repl();
		await r.eval("(range 20)");
		const { model, user } = await r.evalOutput("(head range-1 12)");
		expect(model).toContain("6 of 12 words shown");
		expect(user).not.toContain("words shown");
	});
});

describe("extracting, then echoing", () => {
	it("names what grep extracted so the next form can use it", async () => {
		const r = await repl();
		expect(
			await r.eval('(grep "see https://x.dev/a now" "https?://[^ ]+")'),
		).toBe('grep-1: ("https://x.dev/a")\n');
		expect(await r.eval("(echo (car grep-1))")).toBe("https://x.dev/a\n");
	});
});

describe("capping echo output", () => {
	it("stops a long echo loop for the model and says how much it dropped", async () => {
		const r = await repl();
		const out = await r.eval("(dotimes (i 20) (echo i))");
		expect(out).toContain("0\n1\n2\n3\n4\n5\n");
		expect(out).toContain("14 more words of echo output not shown to you");
		expect(out).not.toContain("7\n");
	});

	it("hands the human the whole output while capping the model's copy", async () => {
		const r = await repl();
		const { model, user } = await r.evalOutput("(dotimes (i 20) (echo i))");
		expect(model).toContain("not shown to you");
		expect(user).not.toContain("not shown to you");
		expect(user).toContain("19\n");
		expect(model).toContain("nil\n");
		expect(user.endsWith("nil\n")).toBe(true);
		expect(model.endsWith("echo a named value you can page through\n")).toBe(
			true,
		);
	});

	it("leaves short output exactly as it was written", async () => {
		const r = await repl();
		expect(await r.eval('(echo "a b")')).toBe("a b\n");
	});

	it("hands back an offset that echo continues from without a gap", async () => {
		const r = await repl();
		await r.eval("(range 20)");
		expect(await r.eval("(echo range-1 :offset 6)")).toBe(
			"13 12 11 10 9 8\n... 6 of 20 words shown, 6 above, 8 below — read on with (echo range-1 :offset 12)\n",
		);
	});

	it("does not name or re-truncate the output of echo itself", async () => {
		const r = await repl();
		await r.eval("(range 20)");
		await r.eval("(echo range-1)");
		expect(await r.eval("(dump)")).not.toContain("echo-1");
	});
});

describe("errors", () => {
	it("still renders inline rather than throwing", async () => {
		const r = await repl();
		expect(await r.eval('(no-such-fn "x")')).toMatch(/EvalException/);
	});

	it("caps a huge error message", async () => {
		const r = await repl();
		const out = await r.eval("(error (range 40))");
		expect(out).toContain("(error message truncated)");
	});

	it("renders an error raised inside a multi-form loop body", async () => {
		const r = await repl();
		expect(
			await r.eval("(dotimes (i 20) (no-such-fn i) (no-such-fn 2))"),
		).toMatch(/EvalException/);
	});
});

describe("reset", () => {
	it("restarts the numbering along with the definitions", async () => {
		const r = await repl();
		expect(await r.eval("(range 2)")).toBe("range-1: (1 0)\n");
		r.reset();
		await r.eval(RANGE);
		expect(await r.eval("(range 2)")).toBe("range-1: (1 0)\n");
	});
});
