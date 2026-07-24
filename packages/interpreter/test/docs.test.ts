import { describe, expect, it } from "vitest";
import { ev, freshInterp } from "./helpers.ts";

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
