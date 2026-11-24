import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { markdownFor, symbolAt } from "../src/cursor.ts";
import { languageService, symbolTable } from "../src/index.ts";

function doc(content: string): TextDocument {
	return TextDocument.create("file:///test.lisp", "lisp", 1, content);
}

const service = languageService(
	symbolTable(
		["playwright/browser_navigate", "outer", "inner"].map((name) => ({
			name,
		})),
	),
);

describe("the call the cursor is in", () => {
	it("finds the head of the call the cursor is nested in", () => {
		const document = doc('(playwright/browser_navigate :url "x")');
		expect(
			service.callAt(document, { line: 0, character: 34 })?.entry.name,
		).toBe("playwright/browser_navigate");
	});

	it("is not thrown off by a paren inside a string", () => {
		const document = doc('(outer (inner ")" :k');
		expect(
			service.callAt(document, { line: 0, character: 20 })?.entry.name,
		).toBe("inner");
	});

	it("is nothing right after the opening paren with no head yet", () => {
		expect(service.callAt(doc("("), { line: 0, character: 1 })).toBeUndefined();
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
	it("still renders the fenced signature when the doc is empty", () => {
		expect(markdownFor("(foo x)", undefined)).toBe("```lisp\n(foo x)\n```\n");
	});
});

describe("hover over a symbol", () => {
	const hovered = languageService(
		symbolTable([
			{ name: "bare" },
			{ name: "blank", doc: "" },
			{ name: "told", doc: "does a thing" },
		]),
	);
	const at = (name: string) =>
		hovered.hover(doc(`(${name})`), { line: 0, character: 2 });

	it("shows nothing when there is neither a signature nor a doc", () => {
		expect(at("bare")).toBeNull();
		expect(at("blank")).toBeNull();
	});

	it("shows the bare doc body when there is no signature", () => {
		expect(at("told")?.contents).toEqual({
			kind: "markdown",
			value: "does a thing",
		});
	});
});
