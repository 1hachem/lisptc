import { describe, expect, it } from "vitest";
import {
	assert,
	Cell,
	dataToJson,
	EndOfFile,
	isSpecialForm,
	jsonToLisp,
	listToArray,
	mapcar,
	newSym,
	quoteSym,
	Unspecified,
} from "../src/objects.ts";
import { Reader } from "../src/reader.ts";

describe("objects", () => {
	it("fails an assertion with and without a message", () => {
		expect(() => assert(false, "why")).toThrow("Assertion Failure: why");
		expect(() => assert(false)).toThrow("Assertion Failure: ");
	});

	it("refuses to turn an existing symbol into a keyword", () => {
		newSym("objects-test-plain");
		expect(() => newSym("objects-test-plain", true)).toThrow(
			"objects-test-plain",
		);
	});

	it("prints a raw cell as a dotted pair", () => {
		expect(String(new Cell(1, 2))).toBe("(1 . 2)");
	});

	it("tells special forms from plain symbols", () => {
		expect(isSpecialForm(quoteSym)).toBe(true);
		expect(isSpecialForm(newSym("car"))).toBe(false);
	});

	it("names its sentinels", () => {
		expect(String(EndOfFile)).toBe("EOF");
		expect(String(Unspecified)).toBe("#<unspecified>");
	});

	it("turns a list into an array", () => {
		expect(listToArray(new Cell(1, new Cell(2, null)))).toEqual([1, 2]);
		expect(listToArray(null)).toEqual([]);
	});

	it("maps nil to nil and keeps an unchanged list", () => {
		expect(mapcar(null, (x) => x)).toBeNull();
		const list = new Cell(1, new Cell(2, null));
		expect(mapcar(list, (x) => x)).toBe(list);
		expect(listToArray(mapcar(list, (x) => (x as number) * 2))).toEqual([2, 4]);
	});

	it("stringifies what JSON cannot carry", () => {
		expect(jsonToLisp(Symbol.for("s"))).toBe("Symbol(s)");
		expect(jsonToLisp(undefined)).toBeNull();
		expect(jsonToLisp(false)).toBeNull();
	});
});

describe("dataToJson", () => {
	const read = (text: string): unknown => {
		const reader = new Reader();
		reader.push(text);
		return reader.read();
	};

	it("turns a keyword plist into an object and a list into an array", () => {
		expect(
			dataToJson(
				read('(:title "Hi" :sections ((:type :hero :n 2 :ok t) (:type :faq)))'),
			),
		).toEqual({
			title: "Hi",
			sections: [{ type: "hero", n: 2, ok: true }, { type: "faq" }],
		});
	});

	it("reads nil as null, a symbol as its name and a float as a number", () => {
		expect(dataToJson(read("(a nil 1.5)"))).toEqual(["a", null, 1.5]);
	});

	it("keeps an odd or keyword-led list that is not a plist as an array", () => {
		expect(dataToJson(read("(:a :b :c)"))).toEqual(["a", "b", "c"]);
		expect(dataToJson(read("(1 :a 2)"))).toEqual([1, "a", 2]);
	});

	it("refuses what JSON cannot hold", () => {
		expect(() => dataToJson(read("(1 . 2)"))).toThrow(/dotted pair/);
	});
});
