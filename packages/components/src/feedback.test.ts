import { describe, expect, it } from "vitest";
import { quip, surveyResponse } from "./feedback.ts";

describe("a review of one agent message", () => {
	it("sends the thumb complete, so a vote is never lost waiting on a sentence", () => {
		expect(surveyResponse({ thumb: "up", submissionId: "sub-1" })).toEqual({
			$survey_response: 1,
			$survey_submission_id: "sub-1",
			$survey_completed: true,
		});
	});

	it("repeats the thumb with the sentence, as a second answer under one id must", () => {
		expect(
			surveyResponse({ thumb: "down", submissionId: "sub-1", text: "looped" }),
		).toEqual({
			$survey_response: 2,
			$survey_response_1: "looped",
			review_text: "looped",
			$survey_submission_id: "sub-1",
			$survey_completed: true,
		});
	});

	it("has something to say either way", () => {
		expect(quip("up")).toBeTruthy();
		expect(quip("down")).toBeTruthy();
	});
});
