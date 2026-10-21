import { knowledgeExtension } from "@repo/knowledge-extension";
import { knowledgeHostFor } from "@repo/knowledge-extension/host";
import { MemoryKnowledgeStore } from "@repo/knowledge-extension/ports";
import { describe, expect, it } from "vitest";
import { memoryRepl, modelFacing } from "./helpers.ts";

function attachingRepl() {
	const store = new MemoryKnowledgeStore();
	store.write("report.md", "# r", "text/markdown");
	return memoryRepl([
		...modelFacing(),
		knowledgeExtension(knowledgeHostFor({ store, maxDownloadBytes: 1024 })),
	]);
}

describe("a step that attaches a file", () => {
	it("hands the attachments back beside the output", async () => {
		const out = await attachingRepl().evalOutput(
			'(attachments/write "chart.svg" "<svg/>") (attachments/attach "chart.svg") (knowledge/attach "report.md")',
		);
		expect(out.annotations.output.attachments).toEqual([
			{ folder: "attachments", name: "chart.svg" },
			{ folder: "knowledge", name: "report.md" },
		]);
	});

	it("reports no attachments for a step that attached none", async () => {
		const out = await attachingRepl().evalOutput("(+ 1 2)");
		expect(out.annotations.output).not.toHaveProperty("attachments");
	});
});
