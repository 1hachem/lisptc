import { describe, expect, test } from "vitest";
import { ev } from "./helpers.ts";

describe("string library", () => {
	test("concat", () =>
		expect(ev(`(concat "foo" "bar" "baz")`)).toBe(`"foobarbaz"`));
	test("char", () => {
		expect(ev(`(char "hello" 1)`)).toBe(`"e"`);
		expect(ev(`(char "hello" 9)`)).toBe("nil");
	});
	test("substring", () => {
		expect(ev(`(substring "hello world" 6)`)).toBe(`"world"`);
		expect(ev(`(substring "hello world" 0 5)`)).toBe(`"hello"`);
	});
	test("case", () => {
		expect(ev(`(string-upcase "Foo")`)).toBe(`"FOO"`);
		expect(ev(`(string-downcase "Foo")`)).toBe(`"foo"`);
	});
	test("index / contains", () => {
		expect(ev(`(string-index "abcabc" "bc")`)).toBe("1");
		expect(ev(`(string-index "abcabc" "bc" 3)`)).toBe("4");
		expect(ev(`(string-index "abc" "z")`)).toBe("nil");
		expect(ev(`(string-contains? "hello" "ell")`)).toBe("t");
	});
	test("count", () => {
		expect(ev(`(string-count "banana" "a")`)).toBe("3");
		expect(ev(`(string-count "aaaa" "aa")`)).toBe("2");
	});
	test("replace", () => {
		expect(ev(`(string-replace "a-b-c" "-" "+")`)).toBe(`"a+b+c"`);
		expect(ev(`(string-replace "hello" "l" "L")`)).toBe(`"heLLo"`);
	});
	test("split / join", () => {
		expect(ev(`(string-split "a,b,c" ",")`)).toBe(`("a" "b" "c")`);
		expect(ev(`(string-split "abc" "")`)).toBe(`("a" "b" "c")`);
		expect(ev(`(string-join '("a" "b" "c") "-")`)).toBe(`"a-b-c"`);
		expect(ev(`(string-join (string-split "x.y.z" ".") "/")`)).toBe(`"x/y/z"`);
	});
	test("prefix / suffix", () => {
		expect(ev(`(string-prefix? "he" "hello")`)).toBe("t");
		expect(ev(`(string-suffix? "lo" "hello")`)).toBe("t");
		expect(ev(`(string-suffix? "xx" "hello")`)).toBe("nil");
	});
	test("trim", () => expect(ev(`(string-trim "  hi \\n")`)).toBe(`"hi"`));
});
