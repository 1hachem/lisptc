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

describe("%sort :near", () => {
	it("orders the elements by distance in meaning from the query, closest first", async () => {
		const { ev, seen } = embedding(VECTORS);
		expect(
			await ev(
				'(%sort (list "weather" "bug" "money back") :near "give me my money")',
			),
		).toBe('("money back" "bug" "weather")');
		expect(seen).toHaveLength(1);
	});

	it("orders farthest first with :desc t", async () => {
		const { ev } = embedding(VECTORS);
		expect(
			await ev('(%sort (list "money back" "weather") :near "refund" :desc t)'),
		).toBe('("weather" "money back")');
	});

	it("gives the closest element with %min and the farthest with %max", async () => {
		const { ev } = embedding(VECTORS);
		expect(
			await ev(
				'(%min (list "weather" "money back" "bug") :near "give me my money")',
			),
		).toBe('"money back"');
		expect(
			await ev(
				'(%max (list "weather" "money back" "bug") :near "give me my money")',
			),
		).toBe('"weather"');
	});

	it("puts an element equal to the query first without embedding", async () => {
		const { ev, seen } = embedding({});
		expect(await ev('(%sort (list "refund" "refund") :near "refund")')).toBe(
			'("refund" "refund")',
		);
		expect(seen).toHaveLength(0);
	});

	it("refuses :by and :near together", async () => {
		const { failure } = embedding(VECTORS);
		expect(
			await failure('(%sort (list "bug") :near "refund" :by "urgency")'),
		).toContain("not both");
	});
});

describe("%similarity-each", () => {
	it("measures the value against every element in one call", async () => {
		const { ev, seen } = embedding(VECTORS);
		expect(
			await ev('(%similarity-each "refund" (list "refund" "weather"))'),
		).toBe("(1.0 0.0)");
		expect(seen).toEqual([{ inputs: ["refund", "weather"] }]);
	});
});

describe("%outliers", () => {
	it("returns the elements nothing else in the list is close to", async () => {
		const { ev } = embedding(VECTORS);
		expect(
			await ev(
				'(%outliers (list "refund" "money back" "weather" "give me my money"))',
			),
		).toBe('("weather")');
	});

	it("never counts an element with an equal twin", async () => {
		const { ev } = embedding(VECTORS);
		expect(
			await ev('(%outliers (list "weather" "weather" "refund" "money back"))'),
		).toBe("nil");
	});

	it("finds none in a list of equal elements, without embedding", async () => {
		const { ev, seen } = embedding({});
		expect(await ev('(%outliers (list "a" "a"))')).toBe("nil");
		expect(seen).toHaveLength(0);
	});
});

describe("%choose :examples", () => {
	const EXAMPLES =
		'\'((:billing "money back") (:technical "crash") (:other "weather"))';

	it("picks the option whose examples are nearest in meaning", async () => {
		const { ev } = embedding(VECTORS);
		expect(
			await ev(
				`(%choose "refund" '(:billing :technical :other) :examples ${EXAMPLES})`,
			),
		).toBe(":billing");
		expect(
			await ev(
				`(%choose "bug" '(:billing :technical :other) :examples ${EXAMPLES})`,
			),
		).toBe(":technical");
	});

	it("answers an exact example without embedding", async () => {
		const { ev, seen } = embedding({});
		expect(
			await ev(
				`(%choose "crash" '(:billing :technical :other) :examples ${EXAMPLES})`,
			),
		).toBe(":technical");
		expect(seen).toHaveLength(0);
	});

	it("returns the :none value when no example is :min similar", async () => {
		const { ev } = embedding(VECTORS);
		expect(
			await ev(
				'(%choose "refund" \'(:technical :other) :examples \'((:technical "crash") (:other "weather")) :none :unknown :min 0.5)',
			),
		).toBe(":unknown");
	});

	it("names an option that has no examples", async () => {
		const { failure } = embedding(VECTORS);
		expect(
			await failure(
				'(%choose "refund" \'(:billing :technical) :examples \'((:billing "money back")))',
			),
		).toContain("technical has no examples");
	});
});
