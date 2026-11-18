import { describe, expect, it } from "vitest";
import { z } from "zod";
import { driveAsync, type Eval } from "../src/drive.ts";
import { EvalException } from "../src/errors.ts";
import { ev, freshInterp } from "./helpers.ts";

describe("a builtin that suspends under the synchronous driver", () => {
	function suspending() {
		const interp = freshInterp();
		interp.def("slow", 0, "(slow)", "", z.tuple([]), () => Promise.resolve(1n));
		return interp;
	}

	it("raises a failure that try catches", () => {
		expect(ev("(try (slow) (catch (e) 'caught))", suspending())).toBe("caught");
	});

	it("refuses the form when nothing catches it", () => {
		expect(() => ev("(slow)", suspending())).toThrow(EvalException);
	});
});

describe("driveAsync", () => {
	it("throws a rejection back into the generator", async () => {
		function* gen(): Eval<string> {
			try {
				yield Promise.reject(new Error("boom"));
			} catch (ex) {
				return (ex as Error).message;
			}
			return "unreached";
		}
		expect(await driveAsync(gen())).toEqual({ value: "boom" });
	});
});
