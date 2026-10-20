import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
	COMPLETION_TRIGGERS,
	insideForm,
	languageService,
	lispIn,
	type SymbolEntry,
	symbolsOf,
	symbolTable,
	UNCLOSED,
} from "../src/index.ts";

const ENTRIES: SymbolEntry[] = [
	{
		name: "car",
		signature: "(car list)",
		doc: "First element.",
		arity: { min: 1, max: 1 },
	},
	{
		name: "fs/read_file",
		signature: "(fs/read_file :path :encoding)",
		doc: "Read a file.",
		args: [
			{ name: "path", type: "string", required: true, description: "Where." },
			{ name: "encoding", type: "string", required: false },
		],
	},
	{
		name: "paint",
		signature: "(paint target :mode)",
		args: [
			{ name: "target", type: "string", required: true },
			{
				name: "mode",
				type: "string",
				required: false,
				values: [
					{ value: "wash", description: "Thin coat.\nDries fast." },
					{ value: "fill" },
				],
			},
		],
	},
];

const service = languageService(symbolTable(ENTRIES));

function doc(content: string): TextDocument {
	return TextDocument.create("file:///test.lisp", "lisp", 1, content);
}

function endOf(document: TextDocument) {
	return document.positionAt(document.getText().length);
}

describe("completions", () => {
	it("offers every symbol in the table", () => {
		const document = doc("(c");
		expect(
			service.completions(document, endOf(document)).map((i) => i.label),
		).toEqual(["car", "fs/read_file", "paint"]);
	});

	it("puts the call's keyword arguments first, required before optional", () => {
		const document = doc("(fs/read_file ");
		const labels = service
			.completions(document, endOf(document))
			.map((i) => i.label);
		expect(labels.slice(0, 2)).toEqual([":path", ":encoding"]);
		expect(labels).toContain("car");
	});

	it("offers only the call's keyword arguments after a colon", () => {
		const document = doc("(fs/read_file :");
		expect(
			service.completions(document, endOf(document)).map((i) => i.label),
		).toEqual([":path", ":encoding"]);
	});

	it("keeps offering the keyword arguments while one is being typed", () => {
		const document = doc("(fs/read_file :path");
		expect(
			service.completions(document, endOf(document)).map((i) => i.label),
		).toEqual([":path", ":encoding"]);
	});

	it("leaves out a keyword argument the call already supplies", () => {
		const document = doc('(fs/read_file :path "a" :en');
		expect(
			service.completions(document, endOf(document)).map((i) => i.label),
		).toEqual([":encoding"]);
	});

	it("offers keyword arguments in an inner call after a colon", () => {
		const document = doc('(car (paint "wall" :');
		expect(
			service.completions(document, endOf(document)).map((i) => i.label),
		).toEqual([":target", ":mode"]);
	});

	it("offers symbols after a colon in a call that declares no arguments", () => {
		const document = doc("(car :");
		expect(
			service.completions(document, endOf(document)).map((i) => i.label),
		).toContain("car");
	});

	it("offers only a keyword argument's values inside its string", () => {
		const document = doc('(paint "wall" :mode "');
		const items = service.completions(document, endOf(document));
		expect(items.map((i) => i.label)).toEqual(["wash", "fill"]);
		expect(items[0]?.detail).toBe("Thin coat.");
		expect(items.map((i) => i.sortText)).toEqual(["0", "1"]);
	});

	it("offers a positional argument's values inside its string", () => {
		const document = doc('(paint "wall" "');
		expect(
			service.completions(document, endOf(document)).map((i) => i.label),
		).toEqual(["wash", "fill"]);
	});

	it("falls back to symbols in a string whose argument declares no values", () => {
		const document = doc('(paint "w');
		expect(
			service.completions(document, endOf(document)).map((i) => i.label),
		).toContain("car");
	});
});

describe("COMPLETION_TRIGGERS", () => {
	it("are the characters that open a keyword argument and a string value", () => {
		expect(COMPLETION_TRIGGERS).toEqual([":", '"']);
	});
});

describe("hover", () => {
	it("renders the signature and the doc of the symbol under the cursor", () => {
		const hover = service.hover(doc("(car x)"), { line: 0, character: 2 });
		expect(hover?.contents).toEqual({
			kind: "markdown",
			value: "```lisp\n(car list)\n```\nFirst element.",
		});
		expect(hover?.range).toEqual({
			start: { line: 0, character: 1 },
			end: { line: 0, character: 4 },
		});
	});

	it("stops a symbol at the end of its line", () => {
		const hover = service.hover(doc("(car\nx)"), { line: 0, character: 3 });
		expect(hover?.range?.end).toEqual({ line: 0, character: 4 });
	});

	it("returns null for a symbol the table does not know", () => {
		expect(service.hover(doc("(nope)"), { line: 0, character: 2 })).toBeNull();
	});
});

describe("diagnostics", () => {
	it("reports a missing required argument", () => {
		expect(
			service
				.diagnostics(doc('(fs/read_file :encoding "utf8")'))
				.map((d) => d.message),
		).toEqual(['fs/read_file: missing required argument ":path"']);
	});

	it("reports a wrong argument count", () => {
		expect(service.diagnostics(doc("(car)")).map((d) => d.message)).toEqual([
			"car: expected 1 argument, got 0",
		]);
	});

	it("reports a syntax error instead of call errors, and marks an unclosed form", () => {
		const [error] = service.diagnostics(doc("(car"));
		expect(error.code).toBe(UNCLOSED);
	});
});

describe("callAt and signatureHelp", () => {
	it("knows which arguments the call has and which one is being written", () => {
		const document = doc("(fs/read_file :encoding ");
		const call = service.callAt(document, endOf(document));
		expect(call?.entry.name).toBe("fs/read_file");
		expect([...(call?.supplied ?? [])]).toEqual(["encoding"]);
		expect(call?.active).toBe("encoding");
		expect(service.signatureHelp(document, endOf(document))).toMatchObject({
			signatures: [
				{
					label: "(fs/read_file :path :encoding)",
					parameters: [
						{
							label: ":path",
							documentation: { value: "string (required): Where." },
						},
						{ label: ":encoding", documentation: { value: "string" } },
					],
				},
			],
			activeParameter: 1,
		});
	});

	it("reads the innermost open call", () => {
		const document = doc("(fs/read_file :path (car ");
		expect(service.callAt(document, endOf(document))?.entry.name).toBe("car");
	});

	it("has nothing outside a call", () => {
		const document = doc("car");
		expect(service.callAt(document, endOf(document))).toBeUndefined();
		expect(service.signatureHelp(document, endOf(document))).toBeNull();
		expect(insideForm(document, endOf(document))).toBe(false);
	});
});

describe("lispIn", () => {
	it("blanks the prose of a message in place", () => {
		expect(lispIn("say (car x) now")).toBe("    (car x)    ");
	});

	it("blanks a parenthesized aside", () => {
		expect(lispIn("Free: €0 (2 agents, 10 MB storage)").trim()).toBe("");
	});

	it("keeps a form still being typed", () => {
		expect(lispIn("try (fs/read_file :pa")).toBe("    (fs/read_file :pa");
	});
});

describe("symbolsOf", () => {
	it("reads every global and documented name, without the private ones", () => {
		const entries = symbolsOf({
			globalNames: () => ["car", "_hidden", "x"],
			docs: () => new Map([["car", { signature: "(car l)", doc: "First." }]]),
			arityOf: (name) => (name === "car" ? { min: 1, max: 1 } : undefined),
		});
		expect(entries).toEqual([
			{
				name: "car",
				signature: "(car l)",
				doc: "First.",
				args: undefined,
				arity: { min: 1, max: 1 },
			},
			{
				name: "x",
				signature: undefined,
				doc: undefined,
				args: undefined,
				arity: undefined,
			},
		]);
	});
});
