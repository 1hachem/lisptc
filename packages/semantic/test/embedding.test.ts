import { describe, expect, it } from "vitest";
import { embedding } from "./helpers.ts";

const VECTORS: Record<string, number[]> = {
	refund: [1, 0, 0],
	"money back": [0.95, 0.05, 0],
	"give me my money": [0.9, 0.1, 0],
	bug: [0, 1, 0],
	crash: [0, 0.9, 0.1],
	weather: [0, 0, 1],
};

describe("%embed", () => {
	it("returns the embedding as a list of numbers", async () => {
		const { ev } = embedding({ refund: [0.5, -0.25] });
		expect(await ev('(%embed "refund")')).toBe("(0.5 -0.25)");
	});

	it("embeds the same text once in a session", async () => {
		const { ev, seen } = embedding(VECTORS);
		await ev('(%embed "refund")');
		await ev('(%similarity "refund" "bug")');
		expect(seen.map((r) => r.inputs)).toEqual([["refund"], ["bug"]]);
	});

	it("asks for the model :model names", async () => {
		const { ev, seen } = embedding(VECTORS);
		await ev('(%embed "refund" :model "other-embedder")');
		expect(seen[0]?.model).toBe("other-embedder");
	});
});

describe("%similarity", () => {
	it("is near 1 for texts that mean the same and near 0 for unrelated ones", async () => {
		const { ev } = embedding(VECTORS);
		expect(
			Number(await ev('(%similarity "refund" "money back")')),
		).toBeGreaterThan(0.9);
		expect(Number(await ev('(%similarity "refund" "weather")'))).toBe(0);
	});

	it("answers 1 for equal values without embedding", async () => {
		const { ev, seen } = embedding({});
		expect(Number(await ev('(%similarity "refund" "refund")'))).toBe(1);
		expect(Number(await ev("(%similarity 2 2.0)"))).toBe(1);
		expect(seen).toHaveLength(0);
	});
});

describe("%remove-duplicates", () => {
	it("drops elements that mean the same as an earlier one, in one call", async () => {
		const { ev, seen } = embedding(VECTORS);
		expect(
			await ev(
				'(%remove-duplicates (list "refund" "bug" "money back" "weather"))',
			),
		).toBe('("refund" "bug" "weather")');
		expect(seen).toHaveLength(1);
	});

	it("keeps elements apart that fall under :min", async () => {
		const { ev } = embedding(VECTORS);
		expect(
			await ev('(%remove-duplicates (list "refund" "money back") :min 0.999)'),
		).toBe('("refund" "money back")');
	});

	it("drops equal elements without embedding", async () => {
		const { ev, seen } = embedding({});
		expect(await ev('(%remove-duplicates (list "a" "a" "a"))')).toBe('("a")');
		expect(seen).toHaveLength(0);
	});
});

describe("%cluster", () => {
	it("groups the elements by meaning, in the order of the list", async () => {
		const { ev } = embedding(VECTORS);
		expect(
			await ev(
				'(%cluster (list "bug" "refund" "weather" "crash" "money back" "give me my money"))',
			),
		).toBe(
			'(("bug" "crash") ("refund" "money back" "give me my money") ("weather"))',
		);
	});

	it("puts equal elements in one group without embedding", async () => {
		const { ev, seen } = embedding({});
		expect(await ev('(%cluster (list "a" "a"))')).toBe('(("a" "a"))');
		expect(await ev("(%cluster nil)")).toBe("nil");
		expect(seen).toHaveLength(0);
	});

	it("rejects a :min outside 0 to 1", async () => {
		const { failure } = embedding(VECTORS);
		expect(await failure('(%cluster (list "a" "b") :min 2)')).toContain(
			":min must be between 0 and 1",
		);
	});
});
