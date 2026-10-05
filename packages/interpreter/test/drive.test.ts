import { describe, expect, it } from "vitest";
import { driveAsync, driveSync, type Eval, settled } from "../src/drive.ts";
import { EvalException } from "../src/errors.ts";

describe("driveSync", () => {
	it("returns a value that never suspends", () => {
		expect(driveSync(settled(3))).toBe(3);
	});

	it("throws into a generator that suspends", () => {
		function* gen(): Eval<string> {
			try {
				yield Promise.resolve();
			} catch (ex) {
				return (ex as EvalException).message;
			}
			return "resumed";
		}
		expect(driveSync(gen())).toBe(
			"cannot suspend: this host evaluates synchronously",
		);
	});

	it("propagates the refusal when the generator does not catch it", () => {
		expect(() => driveSync(settled(Promise.resolve(1)))).toThrow(EvalException);
	});
});

describe("driveAsync", () => {
	it("resumes a suspended generator with the settled value", async () => {
		expect(await driveAsync(settled(Promise.resolve(7)))).toEqual({
			value: 7,
		});
	});

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
