import { describe, expect, it } from "vitest";
import { ev, evWithOutput, freshInterp } from "./helpers.ts";

describe("documentation coverage", () => {
	const interp = freshInterp();
	const docs = interp.docs();

	it("documents every global binding (except _-prefixed internals)", () => {
		const undocumented = interp
			.globalNames()
			.filter((name) => !name.startsWith("_") && !docs.has(name));
		expect(undocumented).toEqual([]);
	});

	it("documents the special forms", () => {
		for (const name of ["quote", "progn", "cond", "setq", "lambda", "macro"])
			expect(docs.has(name), name).toBe(true);
	});

	it("derives prelude signatures from the actual argument lists", () => {
		expect(docs.get("mapcar")?.signature).toBe("(mapcar f x)");
		expect(docs.get("defun")).toBeDefined();
	});

	it("registers docs for user definitions with docstrings", () => {
		const i = freshInterp();
		ev('(defun double (x) "Return x times two." (* x 2))', i);
		expect(i.docs().get("double")).toEqual({
			signature: "(double x)",
			doc: "Return x times two.",
		});
	});
});

describe("(doc name)", () => {
	it("prints a built-in's signature and description and returns the symbol", () => {
		const { value, output } = evWithOutput("(doc 'car)");
		expect(value).toBe("car");
		expect(output).toBe(
			"(car list)\n  Return the first element of `list`, or nil for nil.\n",
		);
	});

	it("documents special forms", () => {
		const { output } = evWithOutput("(doc 'cond)");
		expect(output).toContain("(cond (test expr...)...)");
	});

	it("returns nil and reports undocumented names", () => {
		const { value, output } = evWithOutput("(doc 'no-such-binding)");
		expect(value).toBe("nil");
		expect(output).toBe("no-such-binding: undocumented\n");
	});

	it("lists every documented name when called with no argument", () => {
		const { output } = evWithOutput("(doc)");
		const names = output.trim().split("\n");
		expect(names).toContain("car");
		expect(names).toContain("cond");
		expect(names).toContain("defun");
	});
});
