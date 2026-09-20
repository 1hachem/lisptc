import { fileURLToPath } from "node:url";
import { runSync, str } from "@repo/interpreter/lisp";
import { describe, expect, it } from "vitest";
import { proseInterp } from "./helpers.ts";

function fixture(name: string): string {
	return fileURLToPath(new URL(`./fixtures/imports/${name}`, import.meta.url));
}

describe("(import path) on a file written in prose", () => {
	it("reads the definitions and ignores the prose around them", () => {
		const interp = proseInterp();
		runSync(interp, `(import "${fixture("util.ptc")}")`);
		expect(str(runSync(interp, "(double 21)"))).toBe("42");
		expect(str(runSync(interp, "(progn greeting)"))).toBe('"hello from util"');
	});

	it("follows a relative import out of a prose file", () => {
		const interp = proseInterp();
		runSync(interp, `(import "${fixture("math.ptc")}")`);
		expect(str(runSync(interp, "(quad 3)"))).toBe("18");
	});
});
