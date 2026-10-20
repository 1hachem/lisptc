import { describe, expect, it } from "vitest";
import {
	type Mentionable,
	matchingMentions,
	mentionOf,
} from "../src/components/mention-menu.tsx";

const files: Mentionable[] = [
	{ folder: "knowledge", name: "report.md", contentType: "text/markdown" },
	{ folder: "knowledge", name: "Q3 Sales.json", contentType: null },
	{ folder: "attachments", name: "spec.pdf", contentType: "application/pdf" },
];

describe("a file mention", () => {
	it("names the folder and the file", () => {
		expect(mentionOf(files[0])).toBe("@knowledge/report.md");
		expect(mentionOf(files[2])).toBe("@attachments/spec.pdf");
	});

	it("is quoted when the name holds a space", () => {
		expect(mentionOf(files[1])).toBe('@"knowledge/Q3 Sales.json"');
	});

	it("offers the files whose folder or name holds what was typed", () => {
		expect(matchingMentions(files, "").map((file) => file.name)).toEqual([
			"report.md",
			"Q3 Sales.json",
			"spec.pdf",
		]);
		expect(
			matchingMentions(files, "attachments").map((file) => file.name),
		).toEqual(["spec.pdf"]);
		expect(matchingMentions(files, "sal").map((file) => file.name)).toEqual([
			"Q3 Sales.json",
		]);
	});
});
