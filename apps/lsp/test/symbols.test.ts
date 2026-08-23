import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { enclosingCallHead, markdownFor, symbolAt } from "../src/symbols.ts";

function doc(content: string): TextDocument {
	return TextDocument.create("file:///test.lisp", "lisp", 1, content);
}

describe("enclosingCallHead", () => {
	it("finds the head of the call the cursor is nested in", () => {
		const document = doc('(playwright/browser_navigate :url "x")');
		// Cursor right after `:url`, still inside the call.
		expect(enclosingCallHead(document, { line: 0, character: 34 })).toBe(
			"playwright/browser_navigate",
		);
	});

	it("returns undefined outside of any call", () => {
		const document = doc("foo bar");
		expect(
			enclosingCallHead(document, { line: 0, character: 3 }),
		).toBeUndefined();
	});

	it("picks the innermost enclosing call for nested forms", () => {
		const document = doc("(outer (inner :k");
		expect(enclosingCallHead(document, { line: 0, character: 16 })).toBe(
			"inner",
		);
	});

	it("returns undefined right after the opening paren with no head yet", () => {
		const document = doc("(");
		expect(
			enclosingCallHead(document, { line: 0, character: 1 }),
		).toBeUndefined();
	});
});

describe("symbolAt", () => {
	it("returns the symbol and its range at a cursor inside it", () => {
		const document = doc("(foobar 1)");
		const sym = symbolAt(document, 0, 3);
		expect(sym).toEqual({
			name: "foobar",
			range: {
				start: { line: 0, character: 1 },
				end: { line: 0, character: 7 },
			},
		});
	});

	it("returns undefined when the cursor sits on a delimiter", () => {
		const document = doc("(foobar 1)");
		expect(symbolAt(document, 0, 0)).toBeUndefined();
	});

	it("returns undefined in the middle of a multi-space gap between symbols", () => {
		const document = doc("foo  bar");
		expect(symbolAt(document, 0, 4)).toBeUndefined();
	});
});

describe("markdownFor", () => {
	it("returns undefined when there is neither a signature nor a doc", () => {
		expect(markdownFor(undefined, undefined)).toBeUndefined();
		expect(markdownFor(undefined, "")).toBeUndefined();
	});

	it("returns the bare doc body when there is no signature", () => {
		expect(markdownFor(undefined, "does a thing")).toBe("does a thing");
	});

	it("fences the signature and appends the doc body", () => {
		expect(markdownFor("(foo x)", "does a thing")).toBe(
			"```lisp\n(foo x)\n```\ndoes a thing",
		);
	});

	it("still renders the fenced signature when the doc is empty", () => {
		expect(markdownFor("(foo x)", undefined)).toBe("```lisp\n(foo x)\n```\n");
	});
});
