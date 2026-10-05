import { describe, expect, it } from "vitest";
import { introspectionExtension } from "../src/introspection.ts";
import { introspectionHost } from "../src/introspection-host.ts";
import { ev, evWithOutput } from "./helpers.ts";

describe("the extension", () => {
	it("takes its prompt from the host", () => {
		const extension = introspectionExtension({
			...introspectionHost,
			prompt: () => "supplied",
		});
		expect(extension.prompt).toBe("supplied");
	});

	it("reads its colocated .ptc", () => {
		expect(introspectionExtension(introspectionHost).prompt).toMatch(
			/INTROSPECTION/,
		);
	});
});

describe("functionp and macrop", () => {
	it("tells functions from macros and plain values", () => {
		expect(ev("(functionp car)")).toBe("t");
		expect(ev("(functionp (lambda (x) x))")).toBe("t");
		expect(ev("(functionp defun)")).toBe("nil");
		expect(ev("(macrop defun)")).toBe("t");
		expect(ev("(macrop car)")).toBe("nil");
		expect(ev("(functionp 3)")).toBe("nil");
	});
});

describe("signature and docstring", () => {
	it("return the documented strings", () => {
		expect(ev("(signature 'car)")).toBe('"(car list)"');
		expect(ev('(defun sq (x) "Square x." (* x x)) (docstring \'sq)')).toBe(
			'"Square x."',
		);
	});

	it("return nil for an undocumented name", () => {
		expect(ev("(signature 'nope)")).toBe("nil");
		expect(ev("(docstring 'nope)")).toBe("nil");
	});
});

describe("args", () => {
	it("lists the keyword arguments of a definition", () => {
		expect(ev('(defun f (a &key b c) "F." a) (args \'f)')).toBe(
			'((:b "any" nil nil) (:c "any" nil nil))',
		);
	});

	it("returns nil when none are documented", () => {
		expect(ev("(args 'car)")).toBe("nil");
	});
});

describe("apropos", () => {
	it("matches names and docs, ignoring case", () => {
		expect(ev('(apropos "FIRST ELEMENT")')).toContain("car");
		expect(ev('(apropos "cad")')).toContain("cadr");
	});

	it("leaves out internal names", () => {
		expect(ev('(apropos "_set")')).toBe("nil");
	});
});

describe("source", () => {
	it("returns the defining form of a defun and a defmacro", () => {
		expect(ev('(defun sq (x) "Square." (* x x)) (source \'sq)')).toBe(
			'(defun sq (x) "Square." (* x x))',
		);
		expect(ev("(defmacro twice (x) `(progn ,x ,x)) (source 'twice)")).toBe(
			"(defmacro twice (x) `(progn ,x ,x))",
		);
	});

	it("returns nil for a builtin", () => {
		expect(ev("(source 'car)")).toBe("nil");
	});
});

describe("describe", () => {
	it("prints kind, arity and doc for a builtin", () => {
		const { value, output } = evWithOutput("(describe 'car)");
		expect(value).toBe("car");
		expect(output).toContain("car: function, arity (1 1)");
		expect(output).toContain("(car list)");
	});

	it("names a special form and a variable", () => {
		expect(evWithOutput("(describe 'quote)").output).toContain(
			"quote: special form",
		);
		expect(evWithOutput("(setq v 3) (describe 'v)").output).toContain(
			"v: variable",
		);
	});

	it("returns nil for an unbound name", () => {
		const { value, output } = evWithOutput("(describe 'zzz)");
		expect(value).toBe("nil");
		expect(output).toContain("zzz: unbound");
	});
});
