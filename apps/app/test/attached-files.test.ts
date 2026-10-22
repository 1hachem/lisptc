import { describe, expect, it } from "vitest";
import { attachedFiles, attachingFiles } from "../src/lib/attached-files.ts";

describe("what a user message attached", () => {
	it("reads back the files the composer sent beside the text", () => {
		const annotations = attachingFiles(["spec.pdf", "a, b.csv"]);
		expect(
			attachedFiles({
				type: "human",
				content: "see these",
				additional_kwargs: annotations,
			}),
		).toEqual([
			{ folder: "attachments", name: "spec.pdf" },
			{ folder: "attachments", name: "a, b.csv" },
		]);
	});

	it("sends nothing beside the text when no file was attached", () => {
		expect(attachingFiles([])).toBeUndefined();
	});

	it("never reads attachments out of what the user typed", () => {
		expect(
			attachedFiles({
				type: "human",
				content: "hi\n\nattached: knowledge/report.md",
			}),
		).toEqual([]);
	});
});

describe("what a step attached", () => {
	it("reads the files off the lane", () => {
		expect(
			attachedFiles({
				type: "tool",
				content: "",
				additional_kwargs: {
					attachments: [{ folder: "knowledge", name: "report.md" }],
				},
			}),
		).toEqual([{ folder: "knowledge", name: "report.md" }]);
	});

	it("reads nothing from a lane that is not well formed", () => {
		expect(
			attachedFiles({
				type: "tool",
				content: "",
				additional_kwargs: {
					attachments: [
						{ folder: "knowledge", name: "report.md" },
						{ folder: "elsewhere", name: "x" },
					],
				},
			}),
		).toEqual([]);
	});
});
