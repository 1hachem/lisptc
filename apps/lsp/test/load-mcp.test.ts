import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { loadMcpCompletions } from "../src/load-mcp.ts";

function doc(content: string): TextDocument {
	return TextDocument.create("file:///test.lisp", "lisp", 1, content);
}

describe("loadMcpCompletions", () => {
	it("returns undefined when the enclosing call isn't load-mcp", () => {
		const document = doc('(other-fn "pl');
		const position = { line: 0, character: document.getText().length };
		expect(loadMcpCompletions("other-fn", document, position)).toBeUndefined();
	});

	it("offers the bundled toolkit names inside load-mcp's string argument", () => {
		const document = doc('(load-mcp "pl');
		const position = { line: 0, character: document.getText().length };
		const items = loadMcpCompletions("load-mcp", document, position);
		expect(items?.map((i) => i.label)).toEqual(
			expect.arrayContaining(["playwright", "fs", "linear", "posthog"]),
		);
	});

	it("falls through (undefined) for load-mcp's :key plist form", () => {
		const document = doc("(load-mcp :na");
		const position = { line: 0, character: document.getText().length };
		expect(loadMcpCompletions("load-mcp", document, position)).toBeUndefined();
	});

	it("still offers toolkit-name completions when an earlier ; comment contains a quote", () => {
		const line0 = '; say "hello to the user';
		const line1 = '(load-mcp "pl';
		const document = doc(`${line0}\n${line1}`);
		const position = { line: 1, character: line1.length };
		const items = loadMcpCompletions("load-mcp", document, position);
		expect(items?.map((i) => i.label)).toEqual(
			expect.arrayContaining(["playwright", "fs", "linear", "posthog"]),
		);
	});
});
