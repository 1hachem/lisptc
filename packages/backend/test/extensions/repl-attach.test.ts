import { knowledgeExtension } from "@repo/knowledge-extension";
import { knowledgeHostFor } from "@repo/knowledge-extension/host";
import { MemoryKnowledgeStore } from "@repo/knowledge-extension/memory-store";
import { ATTACHMENTS_KIND } from "@repo/shared/files";
import type { Entry } from "@repo/shared/journal";
import { describe, expect, it } from "vitest";
import { memoryRepl, modelFacing } from "./helpers.ts";

const attached = (entries: readonly Entry[]): unknown[] =>
	entries
		.filter((entry) => entry.kind === ATTACHMENTS_KIND)
		.flatMap((entry) => entry.value as unknown[]);

function attachingRepl() {
	const store = new MemoryKnowledgeStore();
	store.write(
		"knowledge",
		"report.md",
		new TextEncoder().encode("# r"),
		"text/markdown",
	);
	return memoryRepl([
		...modelFacing(),
		knowledgeExtension(
			knowledgeHostFor({
				store,
				maxDownloadBytes: 1024,
				attachmentTtlMs: 604_800_000,
				binTtlMs: 2_592_000_000,
			}),
		),
	]);
}

describe("a step that attaches a file", () => {
	it("hands the attachments back beside the output", async () => {
		const out = await attachingRepl().evalOutput(
			'(attachments/write "chart.svg" "<svg/>") (attachments/attach "chart.svg") (knowledge/attach "report.md")',
		);
		expect(attached(out.entries)).toEqual([
			{ folder: "attachments", name: "chart.svg" },
			{ folder: "knowledge", name: "report.md" },
		]);
	});

	it("reports no attachments for a step that attached none", async () => {
		const out = await attachingRepl().evalOutput("(+ 1 2)");
		expect(attached(out.entries)).toEqual([]);
	});
});
