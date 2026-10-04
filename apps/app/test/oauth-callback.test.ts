import { describe, expect, it } from "vitest";
import { callbackState } from "../src/lib/oauth-callback.ts";

const state = "378e720d-4dd0-41f9-a072-09eba84e7267";

describe("callbackState", () => {
	it("reads the state off a callback link", () => {
		expect(
			callbackState(
				`https://app.example/oauth/callback?code=abc&state=${state}`,
			),
		).toBe(state);
	});

	it("rejects a callback without a state", () => {
		expect(callbackState("https://app.example/oauth/callback?code=abc")).toBe(
			undefined,
		);
		expect(callbackState("not a url")).toBe(undefined);
	});
});
