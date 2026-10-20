import { describe, expect, test } from "vitest";
import { envelopeOf } from "../src/messages.ts";

describe("a message envelope", () => {
	test("keeps the fields of the right type and drops the rest", () => {
		expect(
			envelopeOf({
				display: "shown",
				failed: "yes",
				results: ["42", 7],
				quiet: true,
				prose: [{ span: [0, 3], reason: "prose" }],
				ui: { tag: "text" },
			}),
		).toEqual({
			display: "shown",
			quiet: true,
			prose: [{ span: [0, 3], reason: "prose" }],
		});
	});

	test("keeps what a step annotated beside the turn's numbers in its meta", () => {
		expect(
			envelopeOf({ meta: { durationMs: 5, steps: "2", memories: [] } }).meta,
		).toEqual({ durationMs: 5, memories: [] });
	});

	test("is empty for a message with nothing attached", () => {
		expect(envelopeOf(undefined)).toEqual({});
	});
});
