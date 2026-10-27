import { describe, expect, it, vi } from "vitest";
import { setExit } from "../src/core-builtins.ts";
import { newSym } from "../src/objects.ts";
import { ev, freshInterp } from "./helpers.ts";

describe("core builtins", () => {
	it("exits through the installed hook, doing nothing before one is set", () => {
		ev("(exit 0)");
		const exit = vi.fn();
		setExit(exit);
		ev("(exit 3)");
		expect(exit).toHaveBeenCalledWith(3);
	});

	it("refuses to concatenate a non-string", () => {
		expect(() => ev('(concat "a" 1)')).toThrow("not a string");
	});

	it("dumps every global symbol", () => {
		expect(ev("(member 'car (dump))")).not.toBe("nil");
	});

	it("unbinds a defun with its doc and source", () => {
		const interp = freshInterp();
		ev('(defun sq (x) "Square x." (* x x))', interp);
		expect(ev("(makunbound 'sq)", interp)).toBe("t");
		expect(() => ev("(sq 2)", interp)).toThrow();
		expect(interp.docs().has("sq")).toBe(false);
		expect(interp.sourceOf("sq")).toBeUndefined();
		expect(ev("(makunbound 'sq)", interp)).toBe("nil");
	});

	it("unbinds a setq global so it can be bound afresh", () => {
		const interp = freshInterp();
		ev("(setq n 1)", interp);
		ev("(makunbound 'n)", interp);
		expect(ev("(member 'n (dump))", interp)).toBe("nil");
		expect(ev("(setq n 2)", interp)).toBe("2");
	});

	it("leaves builtins and read-only globals bound", () => {
		const interp = freshInterp();
		expect(() => ev("(makunbound 'car)", interp)).toThrow(/builtin/);
		ev("(setq owned 1)", interp);
		interp.seal(newSym("owned"), "test");
		expect(() => ev("(makunbound 'owned)", interp)).toThrow(/read-only/);
		expect(ev("owned", interp)).toBe("1");
	});

	it("reports invalid JSON", () => {
		expect(() => ev('(json-parse "{")')).toThrow("json-parse: invalid JSON");
	});
});
