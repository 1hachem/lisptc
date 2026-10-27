import { describe, expect, test } from "vitest";
import { Budget, exhausted } from "../src/budget.ts";

describe("a budget", () => {
	test("slices a child at most what its parent has left", () => {
		const budget = new Budget();
		budget.open("root", undefined, { steps: 10, tokens: 100, deadline: 50 });
		budget.charge("root", { steps: 7, tokens: 40 });
		expect(
			budget.open("child", "root", { steps: 20, tokens: 20, deadline: 90 }),
		).toEqual({ steps: 3, tokens: 20, deadline: 50 });
	});

	test("bills every ancestor for a grandchild's work", () => {
		const budget = new Budget();
		budget.open("root", undefined, { steps: 10 });
		budget.open("child", "root");
		budget.open("grand", "child", { steps: 4 });
		budget.charge("grand", { steps: 3 });
		expect(budget.remaining("root")).toEqual({ steps: 7 });
		expect(budget.remaining("grand")).toEqual({ steps: 1 });
	});

	test("keeps a child under what its parent spends later", () => {
		const budget = new Budget();
		budget.open("root", undefined, { steps: 10 });
		budget.open("child", "root", { steps: 8 });
		budget.charge("root", { steps: 9 });
		expect(budget.remaining("child")).toEqual({ steps: 1 });
	});

	test("says which limit ran out", () => {
		expect(exhausted({ steps: 0 })).toBe("out of steps");
		expect(exhausted({ tokens: -1 })).toBe("out of tokens");
		expect(exhausted({ deadline: 5 }, 10)).toBe("past its deadline");
		expect(exhausted({ steps: 1 })).toBeUndefined();
	});
});
