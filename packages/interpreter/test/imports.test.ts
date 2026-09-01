import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run, str } from "../src/lisp.ts";
import { freshInterp } from "./helpers.ts";

// Absolute path to a file under test/fixtures/imports/.
function fixture(name: string): string {
	return fileURLToPath(new URL(`./fixtures/imports/${name}`, import.meta.url));
}

// Evaluate `code` after seeding the interpreter's importStack so that relative
// import paths in `code` resolve against the fixtures directory — this is what
// the CLI does for a top-level script file.
function evFrom(dir: string, code: string): string {
	const interp = freshInterp();
	interp.importStack.push(fileURLToPath(new URL(dir, import.meta.url)));
	try {
		return str(run(interp, code));
	} finally {
		interp.importStack.pop();
	}
}

describe("(import path)", () => {
	it("imports every definition from a file (import *)", () => {
		const interp = freshInterp();
		run(interp, `(import "${fixture("util.ptc")}")`);
		// Both the function and the top-level variable are now in scope.
		expect(str(run(interp, "(double 21)"))).toBe("42");
		expect(str(run(interp, "(progn greeting)"))).toBe('"hello from util"');
	});

	it("resolves relative imports against the importing file's directory", () => {
		// math.ptc does (import "./util.ptc") itself, so importing math.ptc
		// transitively pulls in double, which quad relies on.
		const interp = freshInterp();
		run(interp, `(import "${fixture("math.ptc")}")`);
		expect(str(run(interp, "(quad 3)"))).toBe("18"); // double(square(3)) = 18
		expect(str(run(interp, "(double 5)"))).toBe("10"); // transitively imported
	});

	it("resolves a relative path via a seeded importStack (as the CLI does)", () => {
		const out = evFrom("./fixtures/imports/", '(import "./math.ptc") (quad 4)');
		expect(out).toBe("32"); // double(square(4)) = 32
	});

	it("does not loop forever on circular imports", () => {
		const interp = freshInterp();
		run(interp, `(import "${fixture("cycle-a.ptc")}")`);
		expect(str(run(interp, "(a-fn)"))).toBe("1");
		expect(str(run(interp, "(b-fn)"))).toBe("2");
	});

	it("throws when the file cannot be read", () => {
		expect(() => run(freshInterp(), '(import "./does-not-exist.ptc")')).toThrow(
			/cannot read import file/,
		);
	});

	it("rejects a non-string path and a wrong arity", () => {
		expect(() => run(freshInterp(), "(import 42)")).toThrow(/string expected/);
		expect(() => run(freshInterp(), '(import "a" "b")')).toThrow(/arity/);
	});
});
