import { describe, expect, it } from "vitest";
import { contentToText, isRole } from "../src/messages.ts";
import {
	buildProviderSpecs,
	defaultProviderName,
	providerSpecFor,
} from "../src/providers.ts";

describe("provider specs", () => {
	it("falls back to the bundled defaults when nothing is set", () => {
		const specs = buildProviderSpecs({});
		expect(specs.llamacpp.baseUrl).toBe("http://127.0.0.1:8080/v1");
		expect(specs.digitalocean.defaultModel).toBe("gemma-4-31B-it");
		expect(specs.digitalocean.apiKey).toBeUndefined();
	});

	it("takes the base url, model and key from the environment", () => {
		const specs = buildProviderSpecs({
			OPENROUTER_API_KEY: "sk-test",
			OPENROUTER_MODEL: "some/model",
			OPENROUTER_BASE_URL: "http://localhost:1234/v1",
		});
		expect(specs.openrouter).toMatchObject({
			apiKey: "sk-test",
			defaultModel: "some/model",
			baseUrl: "http://localhost:1234/v1",
		});
	});

	it("reads an empty variable as unset, the way the typed env does", () => {
		expect(
			buildProviderSpecs({ DO_API_KEY: "" }).digitalocean.apiKey,
		).toBeUndefined();
	});

	it("resolves the default provider, and refuses an unknown one", () => {
		expect(defaultProviderName({})).toBe("digitalocean");
		expect(defaultProviderName({ LLM_PROVIDER: "fireworks" })).toBe(
			"fireworks",
		);
		expect(() => defaultProviderName({ LLM_PROVIDER: "nowhere" })).toThrow(
			/LLM_PROVIDER is "nowhere", but expected one of/,
		);
		expect(() => providerSpecFor("nowhere")).toThrow(
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
