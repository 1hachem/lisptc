import { describe, expect, it } from "vitest";
import { retiredInputTogglesDropped } from "../convex/lib/preferenceDefaults.ts";

describe("dropping retired chat input toggles", () => {
	it("removes vim and keeps every other toggle as it was", () => {
		expect(
			retiredInputTogglesDropped({ lisp: false, vim: true, send: true }),
		).toEqual({ input: { lisp: false, send: true } });
	});

	it("leaves a row with nothing retired untouched", () => {
		expect(retiredInputTogglesDropped({ lisp: true })).toBeUndefined();
		expect(retiredInputTogglesDropped(undefined)).toBeUndefined();
	});
});
