import { describe, expect, test } from "vitest";
import { greetingOfVisit } from "../src/lib/greeting.ts";

describe("the greeting of a visit", () => {
	test("stays the same line for every chat opened after the first", () => {
		const first = greetingOfVisit(new Date(2026, 9, 21, 9));
		for (let i = 0; i < 20; i++)
			expect(greetingOfVisit(new Date(2026, 9, 21, 21))).toBe(first);
	});
});
