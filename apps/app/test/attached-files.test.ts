import { describe, expect, it } from "vitest";
import { toolAttachments, userAttachments } from "../src/lib/attached-files.ts";
import { withAttachments } from "../src/lib/knowledge.ts";

describe("what a user message attached", () => {
	it("reads back the files the composer appended", () => {
		const sent = withAttachments("see these", ["spec.pdf", "a, b.csv"]);
		expect(userAttachments(sent)).toEqual({
			text: "see these",
			files: [
				{ folder: "attachments", name: "spec.pdf" },
				{ folder: "attachments", name: "a, b.csv" },
			],
		});
	});

	it("reads a message that is only attachments", () => {
		expect(userAttachments(withAttachments("", ["spec.pdf"]))).toEqual({
			text: "",
			files: [{ folder: "attachments", name: "spec.pdf" }],
		});
	});

	it("opens a file attached before the bin was renamed in attachments", () => {
		expect(userAttachments("hi\n\nattached: bin/old.md").files).toEqual([
			{ folder: "attachments", name: "old.md" },
		]);
	});

	it("leaves text alone when the line is not the last, or names no folder", () => {
		const middle = "attached: attachments/a.md\nthen more";
		expect(userAttachments(middle)).toEqual({ text: middle, files: [] });
		const bare = "attached: a.md";
		expect(userAttachments(bare)).toEqual({ text: bare, files: [] });
	});
});

describe("what a step attached", () => {
	it("keeps only well formed files from the lane", () => {
		expect(
			toolAttachments({
				type: "tool",
				content: "",
				additional_kwargs: {
					attachments: [
						{ folder: "knowledge", name: "report.md" },
						{ folder: "elsewhere", name: "x" },
						"nope",
					],
				},
			}),
		).toEqual([{ folder: "knowledge", name: "report.md" }]);
	});
});
