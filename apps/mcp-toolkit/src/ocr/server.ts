import { mistralApiEnv } from "@repo/env/mcps/mistral/api";
import { FastMCP, UserError } from "fastmcp";
import { z } from "zod";
import { OcrConfigError, ocr } from "./api.ts";

const server = new FastMCP({
	name: "ocr",
	version: "0.0.0",
});

server.addTool({
	name: "ocr-document",
	description:
		"Read a scanned PDF or image with Mistral OCR and return its text as Markdown, one entry per page. Tables come back as Markdown tables, so pass the page text to an extraction step to get typed rows. Give exactly one of url (publicly reachable) or path (a local file, which is uploaded first). Returns JSON {model,source,pageCount,pages:[{index,markdown}]}.",
	parameters: z.object({
		url: z
			.string()
			.optional()
			.describe("Publicly reachable URL of the PDF or image."),
		path: z
			.string()
			.optional()
			.describe("Path to a local PDF or image file to upload and read."),
		pages: z
			.array(z.number().int().nonnegative())
			.optional()
			.describe("Zero-based page indices to read. Omit for every page."),
		model: z
			.string()
			.optional()
			.default(mistralApiEnv.MISTRAL_OCR_MODEL)
			.describe("OCR model id."),
	}),
	timeoutMs: 180_000,
	execute: async (args) => {
		try {
			return JSON.stringify(await ocr(args));
		} catch (err) {
			if (err instanceof OcrConfigError) throw new UserError(err.message);
			throw new UserError(err instanceof Error ? err.message : String(err));
		}
	},
});

await server.start({ transportType: "stdio" });
