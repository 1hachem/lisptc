import { describe, expect, it } from "vitest";
import { awaitingOrder, moved } from "./sortable-tree.tsx";

describe("moved", () => {
	const order = ["home", "chat", "memories", "README.md"];

	it("puts the dragged entry where the one it was dropped on was", () => {
		expect(moved(order, "README.md", "chat")).toEqual([
			"home",
			"README.md",
			"chat",
			"memories",
		]);
		expect(moved(order, "home", "memories")).toEqual([
			"chat",
			"memories",
			"home",
			"README.md",
		]);
	});

	it("changes nothing when dropped on itself, outside, or on a stranger", () => {
		expect(moved(order, "chat", "chat")).toBeUndefined();
		expect(moved(order, "chat", undefined)).toBeUndefined();
		expect(moved(order, "chat", "bogus")).toBeUndefined();
	});
});

describe("awaitingOrder", () => {
	const order = ["home", "chat", "memories"];
	const next = ["chat", "home", "memories"];

	it("holds the dropped order until the owner hands a new one", () => {
		expect(awaitingOrder([...order], { next, over: order })).toBe(next);
	});

	it("follows the owner once its order changes, whichever way", () => {
		expect(awaitingOrder(next, { next, over: order })).toBe(next);
		const elsewhere = ["memories", "home", "chat"];
		expect(awaitingOrder(elsewhere, { next, over: order })).toBe(elsewhere);
		expect(awaitingOrder(order, undefined)).toBe(order);
	});
});
