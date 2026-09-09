import { LISP_GRAMMAR } from "@repo/interpreter/grammar";
import { beforeAll, describe, expect, it } from "vitest";

const BASE_URL = "https://grid.example/v1";

type Chat = {
	model: string;
	streaming: boolean;
	modelKwargs?: Record<string, unknown>;
	clientConfig: { baseURL?: string; apiKey?: string };
};

describe("the AI Grid provider", () => {
	let build: (opts: { grammar?: string | null }) => Chat;

	beforeAll(async () => {
		process.env.AI_GRID_API_KEY = "sk-test";
		process.env.AI_GRID_BASE_URL = BASE_URL;
		const { aigrid } = await import("../src/provider/aigrid.ts");
		build = aigrid as unknown as typeof build;
	});

	it("targets the configured grid with its default model", () => {
		const model = build({});
		expect(model.model).toBe("google/gemma-4-31B");
		expect(model.clientConfig).toMatchObject({
			apiKey: "sk-test",
			baseURL: BASE_URL,
		});
		expect(model.streaming).toBe(true);
	});

	it("tries the grammar constraint through the shared response_format spelling", () => {
		const model = build({});
		expect(model.modelKwargs?.response_format).toEqual({
			type: "grammar",
			grammar: LISP_GRAMMAR,
		});
		expect(model.modelKwargs?.repetition_penalty).toBe(1.1);
	});

	it("sends no grammar when the caller waives it", () => {
		expect(
			build({ grammar: null }).modelKwargs?.response_format,
		).toBeUndefined();
	});

	it("refuses to build when the grid is unconfigured", async () => {
		const { buildProviderSpecs } = await import("@repo/shared/providers");
		const { defineProvider } = await import("../src/provider/core.ts");
		const unconfigured = defineProvider(buildProviderSpecs({}).aigrid);
		expect(() => unconfigured({})).toThrow(
			"AI_GRID_API_KEY and AI_GRID_BASE_URL are not set",
		);
	});
});
