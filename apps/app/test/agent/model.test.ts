import { DEFAULT_CHOICE } from "@repo/shared/providers";
import { describe, expect, it } from "vitest";
import { chatModel } from "../../server/agent/model.ts";

describe("the model a chat runs on", () => {
	it("is the one its workspace chose", () => {
		const chosen = {
			provider: "digitalocean",
			model: "gemma-4-31B-it",
		} as const;
		expect(chatModel(chosen)).toEqual(chosen);
	});

	it("is the default when the workspace chose none", () => {
		expect(chatModel(undefined)).toEqual(DEFAULT_CHOICE);
	});
});
