import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("arity", () => {
	it("reports a fixed lambda as (n n)", () => {
		expect(ev("(defun f (a b) a) (arity f)")).toBe("(2 2)");
	});

	it("leaves max nil for a rest argument", () => {
		expect(ev("(defun f (a &rest r) a) (arity f)")).toBe("(1 nil)");
	});

	it("counts keyword arguments as optional", () => {
		expect(ev("(defun f (a b &key c) a) (arity f)")).toBe("(2 3)");
	});

	it("reads a builtin", () => {
		expect(ev("(arity length)")).toBe("(1 1)");
		expect(ev("(arity echo)")).toBe("(0 nil)");
	});

	it("reads a macro", () => {
		expect(ev("(defmacro m (x y) x) (arity m)")).toBe("(2 2)");
	});

	it("returns nil for a value that is not callable", () => {
		expect(ev("(arity 3)")).toBe("nil");
	});
});
