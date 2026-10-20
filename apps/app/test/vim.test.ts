import { describe, expect, it } from "vitest";
import { leaveInsert, normalKey } from "../src/lib/vim.ts";

function run(text: string, caret: number, keys: string) {
	let state = { text, caret, pending: "" };
	let mode = "normal";
	for (const key of keys) {
		const step = normalKey(key, state);
		if (!step) continue;
		state = {
			text: step.text ?? state.text,
			caret: step.caret,
			pending: step.pending,
		};
		if (step.mode) mode = step.mode;
	}
	return { ...state, mode };
}

describe("vim normal mode", () => {
	it("moves within a line and stops at its edges", () => {
		expect(run("hello", 0, "h").caret).toBe(0);
		expect(run("hello", 0, "llllll").caret).toBe(4);
		expect(run("hello", 2, "$").caret).toBe(4);
		expect(run("  hi", 3, "0").caret).toBe(0);
		expect(run("  hi", 3, "^").caret).toBe(2);
	});

	it("moves between lines and keeps the column it can", () => {
		expect(run("abcd\nxy", 3, "j").caret).toBe(6);
		expect(run("abcd\nxy", 6, "k").caret).toBe(1);
		expect(run("abcd\nxy", 1, "k").caret).toBe(1);
	});

	it("jumps by word, back and to the end", () => {
		expect(run("(list-length xs)", 0, "w").caret).toBe(1);
		expect(run("(list-length xs)", 1, "w").caret).toBe(5);
		expect(run("one two", 6, "b").caret).toBe(4);
		expect(run("one two", 0, "e").caret).toBe(2);
	});

	it("deletes a character, the rest of a line and a whole line", () => {
		expect(run("abc", 1, "x")).toMatchObject({ text: "ac", caret: 1 });
		expect(run("abc", 2, "x")).toMatchObject({ text: "ab", caret: 1 });
		expect(run("abc def", 3, "D")).toMatchObject({ text: "abc", caret: 2 });
		expect(run("one\ntwo\nthree", 5, "dd")).toMatchObject({
			text: "one\nthree",
			caret: 4,
		});
		expect(run("one\ntwo", 5, "dd")).toMatchObject({ text: "one", caret: 0 });
	});

	it("goes to the first and last line", () => {
		expect(run("a\nb\nc", 4, "gg").caret).toBe(0);
		expect(run("a\nb\nc", 0, "G").caret).toBe(4);
	});

	it("enters insert mode where each key says", () => {
		expect(run("abc", 1, "i")).toMatchObject({ caret: 1, mode: "insert" });
		expect(run("abc", 1, "a")).toMatchObject({ caret: 2, mode: "insert" });
		expect(run("  abc", 4, "I")).toMatchObject({ caret: 2, mode: "insert" });
		expect(run("abc", 0, "A")).toMatchObject({ caret: 3, mode: "insert" });
		expect(run("ab\ncd", 0, "o")).toMatchObject({
			text: "ab\n\ncd",
			caret: 3,
			mode: "insert",
		});
		expect(run("ab\ncd", 4, "O")).toMatchObject({
			text: "ab\n\ncd",
			caret: 3,
			mode: "insert",
		});
	});

	it("drops a pending operator that no second key completes", () => {
		expect(run("abc", 1, "dl")).toMatchObject({ text: "abc", caret: 1 });
	});

	it("asks for an undo on u and ignores keys it does not know", () => {
		expect(normalKey("u", { text: "a", caret: 0, pending: "" })?.history).toBe(
			"undo",
		);
		expect(normalKey("z", { text: "a", caret: 0, pending: "" })).toBeNull();
	});

	it("steps back one character on leaving insert mode, never past the line", () => {
		expect(leaveInsert("abc", 3)).toBe(2);
		expect(leaveInsert("ab\ncd", 3)).toBe(3);
	});
});
