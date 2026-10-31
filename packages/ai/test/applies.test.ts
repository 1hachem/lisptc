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
		const judged = await appliesJudge(provider)("open my browser", [
			"user wants to automate a browser",
			"user asks about billing",
		]);
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

	it("gives up after its timeout, so the turn is never held by it", async () => {
		const provider: SystemOneProvider = {
			decide: ({ signal }) =>
				new Promise((_, reject) =>
					signal?.addEventListener("abort", () => reject(signal.reason)),
				),
		};
		await expect(appliesJudge(provider, 10)("hi", ["x"])).rejects.toThrow();
	});

	it("waits no longer than the latency measured for a judgment, with room for a cold connection", () => {
		expect(APPLIES_TIMEOUT_MS).toBe(800);
	});
});
