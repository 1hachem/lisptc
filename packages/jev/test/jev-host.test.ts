import type { DecisionsSpec } from "@repo/shared/providers";
import { noul } from "@typesafe-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jevClient } from "../src/jev-host.ts";

const spec: DecisionsSpec = {
	label: "TypeSafe Jev",
	apiKeyEnv: ["JEV_API_KEY", "OPENROUTER_API_KEY"],
	apiKey: "sk-or-v1-test",
	endpoint: "https://openrouter.ai/api/alpha/decisions",
	model: "~typesafe/jev-latest",
	timeoutMs: 5000,
};

function answered(): Response {
	return new Response(
		JSON.stringify({
			model: "typesafe/jev-1.13",
			answers: { urgent: { type: "noul", noul: 0.9 } },
			usage: { input_tokens: 1, output_tokens: 1 },
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("jevClient", () => {
	it("posts the decisions endpoint instead of the TypeSafe one", async () => {
		const fetch = vi.fn(async () => answered());
		vi.stubGlobal("fetch", fetch);

		const result = await jevClient(spec).ask({
			state: "payouts have been failing for 3 days",
			questions: { urgent: noul("Does this convey urgency?") },
		});

		const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
		expect(String(url)).toBe(spec.endpoint);
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body)).model).toBe(spec.model);
		expect(new Headers(init.headers).get("Authorization")).toBe(
			`Bearer ${spec.apiKey}`,
		);
		expect(result.answers.urgent.noul).toBe(0.9);
	});

	it("names both keys when neither is set", () => {
		expect(() =>
			jevClient({ ...spec, apiKey: undefined }).ask({
				state: "anything",
				questions: { urgent: noul("Does this convey urgency?") },
			}),
		).toThrow("JEV_API_KEY or OPENROUTER_API_KEY is not set");
	});
});
