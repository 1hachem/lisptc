import { providerSpecs } from "@repo/env/providers";
import { DEFAULT_PROVIDER } from "@repo/shared/providers";
import { describe, expect, it } from "vitest";
import { chatModel } from "../src/model.ts";

describe("the model a chat runs on", () => {
	const fallback = {
		provider: DEFAULT_PROVIDER,
		model: providerSpecs[DEFAULT_PROVIDER].defaultModel,
	};

	it("is the one its workspace chose", () => {
		const chosen = {
			provider: "digitalocean",
			model: "gemma-4-31B-it",
		};
		expect(chatModel(chosen)).toEqual(chosen);
	});

	it("is the default when the workspace chose none", () => {
		expect(chatModel(undefined)).toEqual(fallback);
	});

	it("is the default when the chosen provider is not one the agent serves", () => {
		expect(chatModel({ provider: "nowhere", model: "x" })).toEqual(fallback);
	});
});
