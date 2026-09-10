import { afterEach, describe, expect, it, vi } from "vitest";

async function load() {
	vi.resetModules();
	return await import("../src/providers.ts");
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("the provider table", () => {
	it("falls back to the bundled defaults when nothing is set", async () => {
		const { providerSpecs, defaultProvider } = await load();
		expect(defaultProvider).toBe("digitalocean");
		expect(providerSpecs.llamacpp.baseUrl).toBe("http://127.0.0.1:8080/v1");
		expect(providerSpecs.digitalocean.defaultModel).toBe("gemma-4-31B-it");
		expect(providerSpecs.digitalocean.apiKey).toBeUndefined();
	});

	it("takes the base url, model and key from the environment", async () => {
		vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
		vi.stubEnv("OPENROUTER_MODEL", "some/model");
		vi.stubEnv("OPENROUTER_BASE_URL", "http://localhost:1234/v1");
		const { providerSpecs } = await load();
		expect(providerSpecs.openrouter).toMatchObject({
			apiKey: "sk-test",
			apiKeyEnv: "OPENROUTER_API_KEY",
			defaultModel: "some/model",
			baseUrl: "http://localhost:1234/v1",
		});
	});

	it("reads an empty variable as unset", async () => {
		vi.stubEnv("DO_API_KEY", "");
		const { providerSpecs } = await load();
		expect(providerSpecs.digitalocean.apiKey).toBeUndefined();
	});

	it("resolves the default provider, and refuses an unknown one", async () => {
		vi.stubEnv("LLM_PROVIDER", "fireworks");
		expect((await load()).defaultProvider).toBe("fireworks");
		vi.stubEnv("LLM_PROVIDER", "nowhere");
		await expect(load()).rejects.toThrow(/LLM_PROVIDER/);
	});

	it("refuses a base url that is not a url", async () => {
		vi.stubEnv("DO_BASE_URL", "not-a-url");
		await expect(load()).rejects.toThrow(/DO_BASE_URL/);
	});
});
