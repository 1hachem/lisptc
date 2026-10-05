import { describe, expect, it, vi } from "vitest";
import { setExit } from "../src/core-builtins.ts";
import { ev } from "./helpers.ts";

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

	it("reports invalid JSON", () => {
		expect(() => ev('(json-parse "{")')).toThrow("json-parse: invalid JSON");
	});
});
