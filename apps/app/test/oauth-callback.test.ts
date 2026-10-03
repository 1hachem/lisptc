import { describe, expect, it } from "vitest";
import {
	awaitsApproval,
	callbackState,
	RESUME_MESSAGE,
} from "../src/lib/oauth-callback.ts";

const state = "378e720d-4dd0-41f9-a072-09eba84e7267";
const authLink = `https://mcp.linear.app/authorize?response_type=code&state=${state}&scope=read+write`;

describe("awaitsApproval", () => {
	it("matches the chat whose repl output carries the login link", () => {
		const lines = [
			{ type: "human", text: "list my linear issues" },
			{ type: "tool", text: JSON.stringify({ output: authLink }) },
		];
		expect(awaitsApproval(lines, state)).toBe(true);
	});

	it("ignores a chat that never issued that state", () => {
		const lines = [{ type: "tool", text: "https://x/authorize?state=other" }];
		expect(awaitsApproval(lines, state)).toBe(false);
	});

	it("does not resume twice once the chat moved on", () => {
		const lines = [
			{ type: "tool", text: authLink },
			{ type: "human", text: RESUME_MESSAGE },
		];
		expect(awaitsApproval(lines, state)).toBe(false);
	});

	it("never carries the code into the resume message", () => {
		expect(RESUME_MESSAGE).not.toContain("code=");
	});
});

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
