import { describe, expect, it } from "vitest";
import { retiredModelReset } from "../convex/lib/models.ts";

describe("a stored workspace model", () => {
	it("is kept while the catalog offers it", () => {
		expect(
			retiredModelReset({
				provider: "openrouter",
				model: "google/gemma-4-31b-it",
			}),
		).toBeUndefined();
	});

	it("is left alone when the workspace chose none", () => {
		expect(retiredModelReset(undefined)).toBeUndefined();
	});

	it("is cleared back to the default once the catalog drops it", () => {
		expect(
			retiredModelReset({ provider: "openrouter", model: "retired/model" }),
		).toEqual({ model: undefined });
	});
});
