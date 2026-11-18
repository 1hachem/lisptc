import { describe, expect, it } from "vitest";
import { readForm, readForms } from "../src/lib/form-reader.ts";

describe("reading a form", () => {
	it("reads strings, numbers, keywords, symbols and nested lists", () => {
		expect(readForm('(retry 3 :on (error "time\\"out"))')).toEqual({
			kind: "list",
			items: [
				{ kind: "symbol", name: "retry" },
				{ kind: "number", value: "3" },
				{ kind: "keyword", name: "on" },
				{
					kind: "list",
					items: [
						{ kind: "symbol", name: "error" },
						{ kind: "string", value: 'time"out' },
					],
				},
			],
		});
	});

	it("reads a symbol at the end of a line without the newline", () => {
		expect(readForm("(permission/deny eval\n  )")).toEqual({
			kind: "list",
			items: [
				{ kind: "symbol", name: "permission/deny" },
				{ kind: "symbol", name: "eval" },
			],
		});
	});

	it("gives nothing for an unbalanced form or for more than one", () => {
		expect(readForm("(a (b)")).toBeUndefined();
		expect(readForm("a)")).toBeUndefined();
		expect(readForm("(a) (b)")).toBeUndefined();
		expect(readForms("(a) (b)")).toHaveLength(2);
	});
});
