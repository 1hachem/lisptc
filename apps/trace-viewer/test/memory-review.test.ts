import { describe, expect, it } from "vitest";
import { MEMORY_SUBJECT, memoryReviewProperties } from "@/lib/memory-review.ts";

describe("feedback about the memory system", () => {
	it("names the memories it is about and how each fired", () => {
		expect(
			memoryReviewProperties({
				memories: [
					{ key: "deploy/notes", body: "use task", on: "user" },
					{ key: "deploy/flags", body: "pass --prod" },
				],
			}),
		).toEqual({
			review_subject: MEMORY_SUBJECT,
			memory_keys: ["deploy/notes", "deploy/flags"],
			memory_triggers: ["user", "linked"],
			memory_recognized: false,
		});
	});

	it("carries the recognition that fired them, with every score it gave", () => {
		const properties = memoryReviewProperties({
			memories: [{ key: "browser/local", body: "load it", on: "when" }],
			recognition: {
				message: "open my browser",
				step: "(fetch url)\n\nneeds javascript",
				scores: { "browser work": 0.9, billing: 0.1 },
				fired: [{ key: "browser/local", body: "load it", on: "when" }],
			},
		});
		expect(properties).toMatchObject({
			memory_recognized: true,
			recognition_message: "open my browser",
			recognition_step: "(fetch url)\n\nneeds javascript",
			recognition_scores: { "browser work": 0.9, billing: 0.1 },
			recognition_fired: ["browser/local"],
		});
	});

	it("reports a recognition that fired nothing, so a missed memory can be flagged", () => {
		expect(
			memoryReviewProperties({
				memories: [],
				recognition: {
					message: "open my browser",
					scores: {},
					error: "timed out",
				},
			}),
		).toMatchObject({
			memory_keys: [],
			recognition_fired: [],
			recognition_error: "timed out",
		});
	});
});
