import { describe, expect, it } from "vitest";
import { Sym } from "../src/objects.ts";
import { str } from "../src/print.ts";

describe("str", () => {
	it("prints a promise opaquely", () => {
		expect(str(Promise.resolve(1))).toBe("#<promise>");
	});

	it("marks an uninterned symbol", () => {
		expect(str(new Sym("loose"))).toBe("#:loose");
	});

	it("prints an array of values", () => {
		expect(str([BigInt(1), "a"])).toBe('[1, "a"]');
	});
});
