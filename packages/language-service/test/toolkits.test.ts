import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { loadMcpCompletions, type Toolkit } from "../src/toolkits.ts";

const toolkits: Toolkit[] = [
	{ name: "playwright", description: "Drive a browser.\nMore." },
	{ name: "fs" },
];

function doc(content: string): TextDocument {
	return TextDocument.create("file:///test.lisp", "lisp", 1, content);
}

function endOf(document: TextDocument) {
	return document.positionAt(document.getText().length);
}

describe("loadMcpCompletions", () => {
	it("returns undefined when the enclosing call isn't load-mcp", () => {
		const document = doc('(other-fn "pl');
		expect(
			loadMcpCompletions("other-fn", document, endOf(document), toolkits),
		).toBeUndefined();
	});

	it("offers the toolkit names inside load-mcp's string argument", () => {
		const document = doc('(load-mcp "pl');
		const items = loadMcpCompletions(
			"load-mcp",
			document,
			endOf(document),
			toolkits,
		);
		expect(items?.map((i) => [i.label, i.detail])).toEqual([
			["playwright", "Drive a browser."],
			["fs", undefined],
		]);
	});

	it("falls through (undefined) for load-mcp's :key plist form", () => {
		const document = doc("(load-mcp :na");
		expect(
			loadMcpCompletions("load-mcp", document, endOf(document), toolkits),
		).toBeUndefined();
	});

	it("still offers toolkit names when earlier prose contains a quote", () => {
		const document = doc('say "hello to the user\n(load-mcp "pl');
		const items = loadMcpCompletions(
			"load-mcp",
			document,
			endOf(document),
			toolkits,
		);
		expect(items?.map((i) => i.label)).toEqual(["playwright", "fs"]);
	});
});
