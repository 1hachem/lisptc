import { describe, expect, it } from "vitest";
import { contentToText, isRole } from "../src/messages.ts";
import {
	assertReachable,
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

	it("has no bundled base url for AI Grid, since only Infisical carries it", () => {
		const specs = buildProviderSpecs({});
		expect(specs.aigrid.baseUrl).toBe("");
		expect(specs.aigrid.defaultModel).toBe("google/gemma-4-31B");
		expect(() => assertReachable(specs.aigrid)).toThrow(
			"AI_GRID_API_KEY and AI_GRID_BASE_URL are not set. Add them to your environment (.env) to talk to AI Grid.",
		);
		expect(() =>
			assertReachable(
				buildProviderSpecs({
					AI_GRID_API_KEY: "sk-test",
					AI_GRID_BASE_URL: "https://grid.example/v1",
				}).aigrid,
			),
		).not.toThrow();
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
			/unknown provider "nowhere", expected one of aigrid, digitalocean, fireworks, llamacpp, openrouter/,
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
