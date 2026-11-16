import { describe, expect, it } from "vitest";
import {
	callOf,
	plainText,
	readForm,
	readForms,
} from "../src/lib/form-reader.ts";

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

describe("reading a call", () => {
	it("splits a saved agent into its name and its options, unquoting the roster", () => {
		const call = callOf(
			readForm(
				'(defagent "reader"\n  :prompt "read it"\n  :permissions "(permission/deny \\"fs/*\\")"\n  :roster \'("helper" "scout")\n  :budget 40)',
			),
		);
		expect(call?.head).toBe("defagent");
		expect(call?.args.map(plainText)).toEqual(["reader"]);
		expect(
			plainText(call?.options.get("prompt") ?? { kind: "string", value: "" }),
		).toBe("read it");
		expect(call?.options.get("permissions")).toEqual({
			kind: "string",
			value: '(permission/deny "fs/*")',
		});
		expect(call?.options.get("roster")).toEqual({
			kind: "list",
			items: [
				{ kind: "string", value: "helper" },
				{ kind: "string", value: "scout" },
			],
		});
		expect(call?.options.get("budget")).toEqual({
			kind: "number",
			value: "40",
		});
	});

	it("gives nothing for a value that is not a call", () => {
		expect(callOf(readForm('"just text"'))).toBeUndefined();
	});
});
