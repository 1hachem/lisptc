import { describe, expect, it } from "vitest";
import {
	newestFirst,
	type RecallDirection,
	type Recalled,
	recall,
	sentHistory,
} from "../src/lib/message-history.ts";

const history = ["first", "second", "third"];

function walk(start: string, moves: RecallDirection[]): string[] {
	let recalled: Recalled | null = null;
	let text = start;
	const seen: string[] = [];
	for (const move of moves) {
		const step = recall(history, recalled, text, move);
		if (step) {
			recalled = step.recalled;
			text = step.text;
		}
		seen.push(text);
	}
	return seen;
}

describe("recalling sent messages", () => {
	it("walks back from the newest and stops at the oldest", () => {
		expect(walk("", ["back", "back", "back", "back"])).toEqual([
			"third",
			"second",
			"first",
			"first",
		]);
	});

	it("walks forward and lands back on the empty input", () => {
		expect(walk("", ["back", "back", "forward", "forward", "forward"])).toEqual(
			["third", "second", "third", "", ""],
		);
	});

	it("leaves a typed draft alone", () => {
		expect(recall(history, null, "half a thought", "back")).toBeNull();
		expect(recall(history, null, "", "forward")).toBeNull();
	});

	it("stops browsing once the recalled text is edited", () => {
		const step = recall(history, null, "", "back");
		expect(step?.text).toBe("third");
		expect(
			recall(history, step?.recalled ?? null, "third!", "back"),
		).toBeNull();
	});

	it("does nothing with no history", () => {
		expect(recall([], null, "", "back")).toBeNull();
	});
});

describe("the sent history", () => {
	it("trims, drops blanks and collapses repeats in a row", () => {
		expect(sentHistory([" a ", "a", "", "b", "a"])).toEqual(["a", "b", "a"]);
	});
});

describe("the prompts to search", () => {
	it("puts the newest first and keeps each prompt once", () => {
		expect(newestFirst(["a", "b", "a", "c"])).toEqual(["c", "a", "b"]);
	});
});
