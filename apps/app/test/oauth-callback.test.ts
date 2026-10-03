import { describe, expect, it } from "vitest";
import {
	awaitsCallback,
	callbackState,
	resumeMessage,
} from "../src/lib/oauth-callback.ts";

const state = "378e720d-4dd0-41f9-a072-09eba84e7267";
const authLink = `https://mcp.linear.app/authorize?response_type=code&state=${state}&scope=read+write`;
const callback = `https://app.example/oauth/callback?code=abc&state=${state}`;

describe("awaitsCallback", () => {
	it("matches the chat whose repl output carries the login link", () => {
		const lines = [
			{ type: "human", text: "list my linear issues" },
			{ type: "tool", text: JSON.stringify({ output: authLink }) },
		];
		expect(awaitsCallback(lines, callback)).toBe(true);
	});

	it("ignores a chat that never issued that state", () => {
		const lines = [{ type: "tool", text: "https://x/authorize?state=other" }];
		expect(awaitsCallback(lines, callback)).toBe(false);
	});

	it("does not resume twice once the callback was handed back", () => {
		const lines = [
			{ type: "tool", text: authLink },
			{ type: "human", text: resumeMessage(callback) },
		];
		expect(awaitsCallback(lines, callback)).toBe(false);
	});

	it("rejects a callback without a state", () => {
		expect(callbackState("https://app.example/oauth/callback?code=abc")).toBe(
			undefined,
		);
		expect(
			awaitsCallback([{ type: "tool", text: authLink }], "not a url"),
		).toBe(false);
	});
});
