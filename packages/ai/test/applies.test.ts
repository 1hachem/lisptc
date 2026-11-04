import { describe, expect, it } from "vitest";
import { APPLIES_TIMEOUT_MS, appliesJudge } from "../src/system-one/applies.ts";
import type {
	SystemOneProvider,
	SystemOneRequest,
} from "../src/system-one/system-one.ts";

function deciding(noul: (instructions: string) => number): {
	seen: SystemOneRequest<string>[];
	provider: SystemOneProvider;
} {
	const seen: SystemOneRequest<string>[] = [];
	return {
		seen,
		provider: {
			async decide<K extends string>(request: SystemOneRequest<K>) {
				seen.push(request);
				const answers = Object.fromEntries(
					Object.entries(request.questions).map(([id, q]) => [
						id,
						{ noul: noul((q as { instructions: string }).instructions) },
					]),
				) as Record<K, { noul: number }>;
				return { answers, cost: 0 };
			},
		},
	};
}

describe("judging which descriptions a message calls for", () => {
	it("asks one noul per description, with the message as the state", async () => {
		const { seen, provider } = deciding((i) =>
			i.includes("browser") ? 0.9 : 0.1,
		);
		const judged = await appliesJudge(provider)(
			{ message: "open my browser" },
			["user wants to automate a browser", "user asks about billing"],
		);
		expect(judged).toEqual(
			new Map([
				["user wants to automate a browser", 0.9],
				["user asks about billing", 0.1],
			]),
		);
		expect(seen[0]?.state).toEqual({ message: "open my browser" });
		expect(Object.values(seen[0]?.questions ?? {}).map((q) => q.type)).toEqual([
			"noul",
			"noul",
		]);
	});

	it("hands the latest step to System One beside the message", async () => {
		const { seen, provider } = deciding(() => 0.5);
		await appliesJudge(provider)(
			{ message: "get me the price", step: "(fetch url)\n\nneeds javascript" },
			["user wants to automate a browser"],
		);
		expect(seen[0]?.state).toEqual({
			message: "get me the price",
			step: "(fetch url)\n\nneeds javascript",
		});
	});

	it("gives up after its timeout, so the turn is never held by it", async () => {
		const provider: SystemOneProvider = {
			decide: ({ signal }) =>
				new Promise((_, reject) =>
					signal?.addEventListener("abort", () => reject(signal.reason)),
				),
		};
		await expect(
			appliesJudge(provider, 10)({ message: "hi" }, ["x"]),
		).rejects.toThrow();
	});

	it("waits at most two seconds for a judgment before a step goes ahead without it", () => {
		expect(APPLIES_TIMEOUT_MS).toBe(2_000);
	});
});
