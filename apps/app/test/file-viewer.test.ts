import { describe, expect, it } from "vitest";
import { knowledgeViewer } from "../src/lib/file-viewer.ts";

describe("knowledgeViewer", () => {
	it.each([
		["photo.png", "image/png", "image"],
		["spec.pdf", "application/pdf", "pdf"],
		["spec.pdf", null, "pdf"],
		["talk.mp4", "video/mp4", "video"],
		["talk.mp3", "audio/mpeg", "audio"],
		["bracket.stl", "application/octet-stream", "stl"],
		["BRACKET.STL", null, "stl"],
		["bracket", "model/stl", "stl"],
		["plan.dwg", "image/vnd.dwg", "download"],
		["PLAN.DWG", null, "download"],
		["plan", "image/vnd.dwg", "download"],
		["notes.md", "text/plain", "markdown"],
		["data.csv", null, "text"],
		["config.json", "application/json", "text"],
		["deck.pptx", "application/octet-stream", "download"],
	] as const)("opens %s (%s) as %s", (name, contentType, viewer) => {
		expect(knowledgeViewer(name, contentType)).toBe(viewer);
	});
});
