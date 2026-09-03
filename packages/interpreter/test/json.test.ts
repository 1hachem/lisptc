import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("(json-parse s)", () => {
	it("turns an object into an alist with string keys, in document order", () => {
		expect(ev('(json-parse "{\\"b\\": 1, \\"a\\": 2}")')).toBe(
			'(("b" . 1.0) ("a" . 2.0))',
		);
		expect(ev('(json-parse "{}")')).toBe("nil");
	});

	it("turns an array into a list", () => {
		expect(ev('(json-parse "[1, \\"two\\", [3]]")')).toBe('(1.0 "two" (3.0))');
		expect(ev('(json-parse "[]")')).toBe("nil");
	});

	it("maps true to t, and both false and null to nil", () => {
		expect(ev('(json-parse "true")')).toBe("t");
		expect(ev('(json-parse "false")')).toBe("nil");
		expect(ev('(json-parse "null")')).toBe("nil");
	});

	it("reads scalars", () => {
		expect(ev('(json-parse "\\"hi\\"")')).toBe('"hi"');
		expect(ev('(json-parse "1.5")')).toBe("1.5");
	});

	it("gives an alist the ordinary accessors work on", () => {
		const doc =
			'(setq d (json-parse "{\\"title\\": \\"Auth bug\\", \\"labels\\": [\\"auth\\", \\"api\\"], \\"state\\": {\\"name\\": \\"open\\"}}"))';
		expect(ev(`${doc} (cdr (assoc "title" d))`)).toBe('"Auth bug"');
		expect(ev(`${doc} (nth 1 (cdr (assoc "labels" d)))`)).toBe('"api"');
		expect(ev(`${doc} (cdr (assoc "name" (cdr (assoc "state" d))))`)).toBe(
			'"open"',
		);
		expect(ev(`${doc} (mapcar car d)`)).toBe('("title" "labels" "state")');
		expect(ev(`${doc} (cdr (assoc "absent" d))`)).toBe("nil");
	});

	it("errors on invalid JSON, catchably", () => {
		expect(() => ev('(json-parse "{oops}")')).toThrow(/json-parse/);
		expect(() => ev('(json-parse "")')).toThrow(/json-parse/);
		expect(ev('(try (json-parse "{oops}") (catch (e) "caught"))')).toBe(
			'"caught"',
		);
	});

	it("does not parse Lisp — that is read's job", () => {
		expect(() => ev('(json-parse "(1 2 3)")')).toThrow(/json-parse/);
	});
});
