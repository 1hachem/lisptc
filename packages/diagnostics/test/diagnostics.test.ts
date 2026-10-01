import { newSym } from "@repo/interpreter/objects";
import { zString } from "@repo/interpreter/schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { freshInterp, reportOf } from "./helpers.ts";

function withTools() {
	const interp = freshInterp();
	for (const name of [
		"playwright/browser_navigate",
		"playwright/browser_click",
	])
		interp.defineGlobal(
			newSym(name),
			interp.makeBuiltIn(name, -1, () => null),
			{ signature: `(${name} & args)`, doc: "A tool." },
		);
	return interp;
}

describe("an unknown name is answered with the nearest one", () => {
	it("names the tool the model meant, with its signature", () => {
		const text = reportOf('(playwright/navigate "x")', withTools());
		expect(text).toContain("did you mean playwright/browser_navigate");
		expect(text).toContain("(playwright/browser_navigate & args)");
	});

	it("keeps the original failure above the suggestion", () => {
		const text = reportOf('(playwright/navigate "x")', withTools());
		expect(text).toContain("undefined: playwright/navigate");
	});

	it("answers a name nested inside another call", () => {
		const text = reportOf('(list (playwright/navigate "x"))', withTools());
		expect(text).toContain("did you mean playwright/browser_navigate");
	});

	it("stays quiet when nothing is close", () => {
		const text = reportOf("(utterly-unrelated-name 1)");
		expect(text).toContain("undefined: utterly-unrelated-name");
		expect(text).not.toContain("did you mean");
	});
});

describe("a bad call is answered with how it is called", () => {
	it("gives the signature and the counts on a wrong argument count", () => {
		const text = reportOf("(car 1 2)");
		expect(text).toContain("given 2, takes 1");
		expect(text).toContain("(car list)");
	});

	it("names the function rather than printing what it compiled to", () => {
		const interp = freshInterp();
		reportOf('(defun area (w h) "Area." (* w h))', interp);
		const text = reportOf("(area 3)", interp);
		expect(text).toContain("arity not matched: area");
		expect(text).not.toContain("#<closure");
	});

	it("counts on the line that named the failure, not on the form", () => {
		const interp = freshInterp();
		reportOf('(defun area (w h) "Area." (* w h))', interp);
		const text = reportOf("(area 3)", interp);
		expect(text).toContain("arity not matched: area — given 1, takes 2");
	});

	it("gives the signature on a wrong argument shape", () => {
		const interp = freshInterp();
		interp.def(
			"shout",
			1,
			"(shout s)",
			"Upper-case a string.",
			z.tuple([zString]),
			([s]) => s.toUpperCase(),
		);
		const text = reportOf("(shout 5)", interp);
		expect(text).toContain("string expected");
		expect(text).toContain("(shout s)");
	});

	it("stays quiet about a name it has no documentation for", () => {
		const interp = freshInterp();
		interp.defineGlobal(
			newSym("bare"),
			interp.makeBuiltIn("bare", 1, () => null),
		);
		const text = reportOf("(bare 1 2)", interp);
		expect(text).toContain("arity not matched");
		expect(text).not.toContain("takes");
	});
});

describe("a name that is bound nowhere is answered with the nearest one", () => {
	function withTotal() {
		const interp = freshInterp();
		reportOf("(setq total 10)", interp);
		return interp;
	}

	it("names the variable the model meant", () => {
		const text = reportOf("(list totl)", withTotal());
		expect(text).toContain("void variable: totl");
		expect(text).toContain("did you mean total");
	});

	it("does not answer with the signature of the call it sits in", () => {
		const text = reportOf("(list totl)", withTotal());
		expect(text).not.toContain("(list x...)");
	});

	it("stays quiet when nothing is close", () => {
		const text = reportOf("(list utterly-unrelated-name)", withTotal());
		expect(text).toContain("void variable: utterly-unrelated-name");
		expect(text).not.toContain("did you mean");
	});
});
