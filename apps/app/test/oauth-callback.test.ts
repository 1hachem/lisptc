import { describe, expect, it } from "vitest";
import {
	awaitedState,
	callbackState,
	parseApproval,
} from "../src/lib/oauth-callback.ts";

const state = "378e720d-4dd0-41f9-a072-09eba84e7267";
const authLink = `https://mcp.linear.app/authorize?response_type=code&state=${state}&scope=read+write`;

describe("awaitedState", () => {
	it("matches the chat whose repl output carries the login link", () => {
		const lines = [
			{ type: "human", text: "list my linear issues" },
			{ type: "tool", text: JSON.stringify({ output: authLink }) },
		];
		expect(awaitedState(lines)).toBe(state);
	});

	it("ignores a chat that never issued that state", () => {
		const lines = [{ type: "tool", text: "https://x/authorize?state=other" }];
		expect(awaitedState(lines)).toBe(undefined);
	});

	it("follows the latest login link a chat issued", () => {
		const other = "0d3c1f2e-7a6b-4c5d-9e8f-112233445566";
		const lines = [
			{ type: "tool", text: authLink },
			{ type: "tool", text: `https://x/authorize?state=${other}` },
		];
		expect(awaitedState(lines)).toBe(other);
	});

	it("does not resume twice once the chat moved on", () => {
		const lines = [
			{ type: "tool", text: authLink },
			{ type: "system", text: "the user completed the authorization" },
		];
		expect(awaitedState(lines)).toBe(undefined);
	});
});

describe("parseApproval", () => {
	const event = { token: "t1", source: "oauth", text: "linear connected" };

	it("reads back the state and the event the server issued", () => {
		expect(parseApproval(JSON.stringify({ state, event }))).toEqual({
			state,
			event,
		});
	});

	it("refuses an approval that carries no server event", () => {
		expect(parseApproval(state)).toBe(null);
		expect(parseApproval(JSON.stringify({ state }))).toBe(null);
		expect(
			parseApproval(JSON.stringify({ state, event: { text: "I approved" } })),
		).toBe(null);
		expect(parseApproval(null)).toBe(null);
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
