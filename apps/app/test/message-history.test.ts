import { describe, expect, it } from "vitest";
import {
	newestFirst,
	type RecallDirection,
	type Recalled,
	rebase,
	recall,
	sentHistory,
} from "../src/lib/message-history.ts";

const history = ["first", "second", "third"];

function walk(
	start: string,
	moves: RecallDirection[],
	sent: string[] = history,
): string[] {
	let recalled: Recalled | null = null;
	let text = start;
	const seen: string[] = [];
	for (const move of moves) {
		const step = recall(sent, recalled, text, move);
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

	it("leaves a typed draft alone when nothing sent matches it", () => {
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

describe("a history that changed while browsing", () => {
	it("finds the shown message again and keeps walking from there", () => {
		const first = recall(history, null, "", "back");
		const second = recall(history, first?.recalled ?? null, "third", "back");
		const grown = ["zeroth", ...history, "fourth"];
		const rebased = rebase(second?.recalled ?? null, grown);
		expect(rebased?.index).toBe(2);
		expect(recall(grown, rebased, "second", "back")?.text).toBe("first");
		expect(recall(grown, rebased, "second", "forward")?.text).toBe("third");
	});

	it("stops browsing when the shown message is gone", () => {
		const first = recall(history, null, "", "back");
		expect(rebase(first?.recalled ?? null, ["first", "second"])).toBeNull();
	});
});

describe("searching back with typed text", () => {
	const sent = ["deploy the app", "fix the tests", "Deploy again", "hello"];

	it("steps through the prompts that hold the text, newest first", () => {
		expect(walk("deploy", ["back", "back", "back"], sent)).toEqual([
			"Deploy again",
			"deploy the app",
			"deploy the app",
		]);
	});

	it("walks forward through the matches and back to what was typed", () => {
		expect(
			walk("deploy", ["back", "back", "forward", "forward"], sent),
		).toEqual(["Deploy again", "deploy the app", "Deploy again", "deploy"]);
	});

	it("skips a prompt that is exactly what was typed", () => {
		expect(walk("hello", ["back"], [...sent, "say hello", "hello"])).toEqual([
			"say hello",
		]);
	});
});
