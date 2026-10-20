import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { closerAt } from "../src/closer.ts";
import { languageService } from "../src/service.ts";

function closer(text: string): string | undefined {
	const caret = text.indexOf("|");
	const document = TextDocument.create(
		"inmemory://test",
		"lisptc",
		0,
		text.replace("|", ""),
	);
	return closerAt(document, document.positionAt(caret))?.newText;
}

describe("closerAt", () => {
	it("closes the form the caret is in", () => {
		expect(closer("(list-length xs|")).toBe(")");
	});

	it("closes the innermost open form first", () => {
		expect(closer("(map (fn (x) x|")).toBe(")");
	});

	it("closes a string before the form around it", () => {
		expect(closer('(print "hello|')).toBe('"');
	});

	it("leaves a string alone when its quote comes later on the line", () => {
		expect(closer('(print "hel|lo")')).toBeUndefined();
	});

	it("leaves a form alone when its paren comes later", () => {
		expect(closer("(list-length xs|)")).toBeUndefined();
		expect(closer("(a (b| c)")).toBeUndefined();
	});

	it("closes nothing outside a form", () => {
		expect(closer("hello|")).toBeUndefined();
	});

	it("answers through the service an editor reads", () => {
		const document = TextDocument.create("inmemory://t", "lisptc", 0, "(+ 1");
		expect(
			languageService(new Map()).closer(document, { line: 0, character: 4 }),
		).toEqual({
			range: {
				start: { line: 0, character: 4 },
				end: { line: 0, character: 4 },
			},
			newText: ")",
		});
	});
});
