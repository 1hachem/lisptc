import { arrayToList, exactJsonToLisp } from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import { Reader } from "@repo/interpreter/reader";
import { describe, expect, it } from "vitest";
import { CODECS, codecFor } from "../src/codecs.ts";
import type { PdfReader } from "../src/ports.ts";

const pdf: PdfReader = { text: (bytes) => new TextDecoder().decode(bytes) };

function form(source: string): unknown {
	const reader = new Reader();
	reader.push(source);
	return reader.read();
}

const SAMPLES: Record<string, unknown> = {
	json: exactJsonToLisp({ a: [false, [], {}], b: [["a", 1]], c: null }),
	ptc: form('(:name "notes" :tags ("a" "b") :n 3)'),
};

describe("every codec", () => {
	for (const [extension, codec] of CODECS)
		it(`reads back what it writes for .${extension}`, async () => {
			const name = `sample.${extension}`;
			const value = SAMPLES[extension] ?? "a,b\n1,2\nü";
			const bytes = new TextEncoder().encode(codec.write(name, value));
			expect(str(await codec.read(name, bytes, pdf))).toBe(str(value));
		});

	it("falls back to plain text for a name with no known extension", () => {
		expect(codecFor("README").contentType).toBe("text/plain");
		expect(codecFor("x.constructor")).toBe(codecFor("x.txt"));
		expect(codecFor("TABLE.CSV")).toBe(CODECS.get("csv"));
	});

	it("refuses data for a text format", () => {
		expect(() =>
			codecFor("notes.md").write("notes.md", arrayToList([1, 2])),
		).toThrow(/holds text/);
	});
});
