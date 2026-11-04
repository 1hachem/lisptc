import { describe, expect, it } from "vitest";
import { attachedTo, attachingFiles } from "../src/lib/attached-files.ts";

describe("what a user message attached", () => {
	it("reads back the files the composer sent beside the text", () => {
		const received = attachingFiles(["spec.pdf", "a, b.csv"]);
		expect(
			attachedTo({
				type: "human",
				content: "see these",
				additional_kwargs: received,
			}),
		).toEqual([
			{ folder: "attachments", name: "spec.pdf" },
			{ folder: "attachments", name: "a, b.csv" },
		]);
	});

	it("reads back the files a step recorded in the journal", () => {
		expect(
			attachedTo({
				type: "tool",
				content: "",
				entries: [
					{
						id: "e1",
						kind: "attachments",
						value: [{ folder: "attachments", name: "chart.svg" }],
					},
				],
			}),
		).toEqual([{ folder: "attachments", name: "chart.svg" }]);
	});

	it("sends nothing beside the text when no file was attached", () => {
		expect(attachingFiles([])).toBeUndefined();
	});

	it("never reads attachments out of what the user typed", () => {
		expect(
			attachedTo({
				type: "human",
				content: "hi\n\nattached: knowledge/report.md",
			}),
		).toEqual([]);
	});
});

describe("what a step attached", () => {
	it("reads the files off the lane", () => {
		expect(
			attachedTo({
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
			attachedTo({
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
