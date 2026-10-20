import {
	File01Icon,
	FileImageIcon,
	Pdf01Icon,
	Xls01Icon,
} from "@hugeicons/core-free-icons";
import { describe, expect, it } from "vitest";
import { knowledgeIcon, knowledgeViewer } from "../src/lib/knowledge.ts";

describe("knowledgeIcon", () => {
	it("reads the extension, whatever its case", () => {
		expect(knowledgeIcon("Spec.PDF", null)).toBe(Pdf01Icon);
		expect(knowledgeIcon("q3.xlsx", "application/octet-stream")).toBe(
			Xls01Icon,
		);
	});

	it("falls back on the content type, then on a plain file", () => {
		expect(knowledgeIcon("scan.heic", "image/heic")).toBe(FileImageIcon);
		expect(knowledgeIcon(".bashrc", null)).toBe(File01Icon);
		expect(knowledgeIcon("blob", "application/octet-stream")).toBe(File01Icon);
	});
});

describe("knowledgeViewer", () => {
	it.each([
		["photo.png", "image/png", "image"],
		["spec.pdf", "application/pdf", "pdf"],
		["spec.pdf", null, "pdf"],
		["talk.mp4", "video/mp4", "video"],
		["talk.mp3", "audio/mpeg", "audio"],
		["notes.md", "text/plain", "markdown"],
		["data.csv", null, "text"],
		["config.json", "application/json", "text"],
		["deck.pptx", "application/octet-stream", "download"],
	] as const)("opens %s (%s) as %s", (name, contentType, viewer) => {
		expect(knowledgeViewer(name, contentType)).toBe(viewer);
	});
});
