import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ArgumentException } from "../src/errors.ts";
import { parseArgs, zAny, zString } from "../src/schema.ts";

function failure(fn: () => unknown): ArgumentException {
	try {
		fn();
	} catch (ex) {
		if (ex instanceof ArgumentException) return ex;
	}
	throw new Error("expected an ArgumentException");
}

describe("parseArgs", () => {
	it("points at the offending argument", () => {
		const ex = failure(() => parseArgs(z.tuple([zAny, zString]), [1, 2]));
		expect(ex.at).toBe(1);
		expect(ex.message).toContain("string expected");
	});

	it("blames the whole list when the count is wrong", () => {
		const args = [1, 2];
		const ex = failure(() => parseArgs(z.tuple([zAny]), args));
		expect(ex.at).toBeUndefined();
	});
});
