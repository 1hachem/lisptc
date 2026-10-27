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
		["logo.svg", "image/svg+xml", "svg"],
		["chart.svg", "text/plain", "svg"],
		["LOGO.SVG", null, "svg"],
		["logo", "image/svg+xml", "svg"],
		["page.html", "text/html", "html"],
		["page.htm", null, "html"],
		["page", "text/html", "html"],
		["plan.dwg", "image/vnd.dwg", "download"],
		["PLAN.DWG", null, "download"],
		["plan", "image/vnd.dwg", "download"],
		["notes.md", "text/plain", "markdown"],
		["data.csv", null, "text"],
		["config.json", "application/json", "json"],
		["config.json", null, "json"],
		["shape", "application/geo+json", "json"],
		["deck.pptx", "application/octet-stream", "download"],
	] as const)("opens %s (%s) as %s", (name, contentType, viewer) => {
		expect(knowledgeViewer(name, contentType)).toBe(viewer);
	});
});
