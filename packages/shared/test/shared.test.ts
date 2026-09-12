import { describe, expect, it } from "vitest";
import { quip, surveyResponse } from "../src/feedback.ts";
import { contentToText, isRole } from "../src/messages.ts";
import { isProviderName, providerSpecFor } from "../src/providers.ts";

const SPECS = {
	digitalocean: {
		label: "DigitalOcean inference",
		apiKey: undefined,
		apiKeyEnv: "DO_API_KEY",
		baseUrl: "https://inference.do-ai.run/v1",
		defaultModel: "gemma-4-31B-it",
	},
} as unknown as Parameters<typeof providerSpecFor>[1];

describe("provider names", () => {
	it("knows the four providers", () => {
		expect(isProviderName("fireworks")).toBe(true);
		expect(isProviderName("nowhere")).toBe(false);
	});

	it("looks a spec up by name, and refuses an unknown one", () => {
		expect(providerSpecFor("digitalocean", SPECS).defaultModel).toBe(
			"gemma-4-31B-it",
		);
		expect(() => providerSpecFor("nowhere", SPECS)).toThrow(
			/unknown provider "nowhere", expected one of digitalocean, fireworks, llamacpp, openrouter/,
		);
	});
});

describe("message helpers", () => {
	it("flattens text content, and gives up on anything else", () => {
		expect(contentToText("plain")).toBe("plain");
		expect(contentToText([{ text: "a" }, "b", { image: 1 }])).toBe("ab");
		expect(contentToText(undefined)).toBe("");
		expect(contentToText({ nested: true })).toBe("");
	});

	it("knows the three roles", () => {
		expect(isRole("assistant")).toBe(true);
		expect(isRole("tool")).toBe(false);
	});
});

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
			$survey_submission_id: "sub-1",
			$survey_completed: true,
		});
	});

	it("has something to say either way", () => {
		expect(quip("up")).toBeTruthy();
		expect(quip("down")).toBeTruthy();
	});
});
