import { describe, expect, it } from "vitest";
import type { CompletionItem } from "vscode-languageserver-types";
import { rankCompletions } from "../src/fuzzy.ts";

const items = (...labels: string[]): CompletionItem[] =>
	labels.map((label) => ({ label }));

const labels = (typed: string, ...from: string[]) =>
	rankCompletions(items(...from), typed).map(({ item }) => item.label);

describe("rankCompletions", () => {
	it("finds a label from letters that are not contiguous", () => {
		expect(labels("lsln", "list-length", "reverse")).toEqual(["list-length"]);
	});

	it("ranks a prefix match above a scattered one", () => {
		expect(labels("le", "file", "length")).toEqual(["length", "file"]);
	});

	it("ranks a match nearer the start of the label above a later one", () => {
		expect(labels("len", "list-length", "silence")).toEqual([
			"silence",
			"list-length",
		]);
	});

	it("ranks the label that is exactly what was typed first", () => {
		expect(labels("load-mcp", "unload-mcp", "load-mcp")).toEqual([
			"load-mcp",
			"unload-mcp",
		]);
	});

	it("offers every label, in sort order, when nothing is typed yet", () => {
		expect(labels("", "sheets", "fs")).toEqual(["fs", "sheets"]);
	});

	it("ignores case", () => {
		expect(labels("LS", "list")).toEqual(["list"]);
	});

	it("breaks a tie by sort text, then by the shorter label", () => {
		const ranked = rankCompletions(
			[
				{ label: "map-b", sortText: "2map-b" },
				{ label: "map-a", sortText: "1map-a" },
			],
			"map",
		);
		expect(ranked.map(({ item }) => item.label)).toEqual(["map-a", "map-b"]);
	});

	it("reports the characters the match covers", () => {
		expect(rankCompletions(items("list-length"), "len")[0]?.matched).toEqual([
			5, 6, 7,
		]);
	});
});
