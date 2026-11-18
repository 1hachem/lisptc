import { describe, expect, it } from "vitest";
import { tolerantly } from "./helpers.ts";

describe("prose channel notes", () => {
	it("notes a skipped aside for the model alone", () => {
		const { value, output, skipped } = tolerantly(
			"an aside (see below)\n(+ 1 2)",
		);
		expect(value).toBe("3");
		expect(skipped).toHaveLength(1);
		expect(skipped[0]).toContain("(see below)");
		expect(output).toBe("");
	});
});
