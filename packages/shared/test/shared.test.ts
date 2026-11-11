import { describe, expect, it } from "vitest";
import { contentToText, isRole } from "../src/messages.ts";
import {
	choiceFrom,
	DEFAULT_CHOICE,
	isProviderName,
	providerSpecFor,
} from "../src/providers.ts";

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
	it("knows the providers it can call, and nothing else", () => {
		expect(isProviderName("digitalocean")).toBe(true);
		expect(isProviderName("openrouter")).toBe(true);
		expect(isProviderName("fireworks")).toBe(false);
		expect(isProviderName("nowhere")).toBe(false);
	});

	it("looks a spec up by name, and refuses an unknown one", () => {
		expect(providerSpecFor("digitalocean", SPECS).defaultModel).toBe(
			"gemma-4-31B-it",
		);
		expect(() => providerSpecFor("nowhere", SPECS)).toThrow(
			/unknown provider "nowhere", expected one of digitalocean, openrouter/,
		);
	});

	it("reads a provider:model pair only when the catalog offers it", () => {
		const { provider, model } = DEFAULT_CHOICE;
		expect(choiceFrom(`${provider}:${model}`, SPECS)).toEqual(DEFAULT_CHOICE);
		expect(() => choiceFrom("openrouter:meta/never-shipped", SPECS)).toThrow(
			/openrouter:meta\/never-shipped is not in the catalog/,
		);
		expect(() => choiceFrom("digitalocean", SPECS)).toThrow(
			/digitalocean:gemma-4-31B-it is not in the catalog/,
		);
		expect(() => choiceFrom("nowhere:x", SPECS)).toThrow(/unknown provider/);
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
