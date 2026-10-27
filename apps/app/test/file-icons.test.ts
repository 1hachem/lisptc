import {
	File01Icon,
	FileImageIcon,
	Pdf01Icon,
	Xls01Icon,
} from "@hugeicons/core-free-icons";
import { describe, expect, it } from "vitest";
import { knowledgeIcon } from "../src/lib/file-icons.ts";

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

	it("never reads an icon off the object prototype", () => {
		expect(knowledgeIcon("x.constructor", null)).toBe(File01Icon);
		expect(knowledgeIcon("x.__proto__", "constructor/x")).toBe(File01Icon);
	});
});
