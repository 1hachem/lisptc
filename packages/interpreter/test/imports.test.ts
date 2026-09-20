import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runSync, str } from "../src/lisp.ts";
import { freshInterp } from "./helpers.ts";

function fixture(name: string): string {
	return fileURLToPath(new URL(`./fixtures/imports/${name}`, import.meta.url));
}

function evFrom(dir: string, code: string): string {
	const interp = freshInterp();
	interp.importStack.push(fileURLToPath(new URL(dir, import.meta.url)));
	try {
		return str(runSync(interp, code));
	} finally {
		interp.importStack.pop();
	}
}

describe("(import path)", () => {
	it("imports every definition from a file (import *)", () => {
		const interp = freshInterp();
		runSync(interp, `(import "${fixture("util.ptc")}")`);
		expect(str(runSync(interp, "(double 21)"))).toBe("42");
		expect(str(runSync(interp, "(progn greeting)"))).toBe('"hello from util"');
	});

	it("resolves relative imports against the importing file's directory", () => {
		const interp = freshInterp();
		runSync(interp, `(import "${fixture("math.ptc")}")`);
		expect(str(runSync(interp, "(quad 3)"))).toBe("18");
		expect(str(runSync(interp, "(double 5)"))).toBe("10");
	});

	it("resolves a relative path via a seeded importStack (as the CLI does)", () => {
		const out = evFrom("./fixtures/imports/", '(import "./math.ptc") (quad 4)');
		expect(out).toBe("32");
	});

	it("does not loop forever on circular imports", () => {
		const interp = freshInterp();
		runSync(interp, `(import "${fixture("cycle-a.ptc")}")`);
		expect(str(runSync(interp, "(a-fn)"))).toBe("1");
		expect(str(runSync(interp, "(b-fn)"))).toBe("2");
	});

	it("throws when the file cannot be read", () => {
		expect(() =>
			runSync(freshInterp(), '(import "./does-not-exist.ptc")'),
		).toThrow(/cannot read import file/);
	});

	it("rejects a non-string path and a wrong arity", () => {
		expect(() => runSync(freshInterp(), "(import 42)")).toThrow(
			/string expected/,
		);
		expect(() => runSync(freshInterp(), '(import "a" "b")')).toThrow(/arity/);
	});
});
