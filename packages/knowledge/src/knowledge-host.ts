import { type Clock, systemClock } from "@repo/shared/host";
import { filePrompt } from "@repo/shared/host-node";
import { getDocumentProxy } from "unpdf";
import type {
	Downloader,
	KnowledgeHost,
	KnowledgeStore,
	PdfReader,
} from "./ports.ts";

const knowledgePrompt = filePrompt(new URL("./knowledge.ptc", import.meta.url));

const FETCH_TIMEOUT_MS = 30_000;

const MAX_PDF_PAGES = 200;

function unpdfReader(maxPages: number): PdfReader {
	return {
		async text(bytes) {
			const pdf = await getDocumentProxy(bytes.slice());
			try {
				const read = Math.min(pdf.numPages, maxPages);
				const pages: string[] = [];
				for (let n = 1; n <= read; n++) {
					const page = await pdf.getPage(n);
					const { items } = await page.getTextContent();
					pages.push(
						items.map((item) => ("str" in item ? item.str : "")).join(" "),
					);
				}
				const skipped = pdf.numPages - read;
				if (skipped > 0)
					pages.push(`[${skipped} more pages past page ${read} not read]`);
				return pages.join("\n");
			} finally {
				await pdf.loadingTask.destroy();
			}
		},
	};
}

async function cappedBody(
	response: Response,
	maxBytes: number,
): Promise<Uint8Array> {
	const tooLarge = () => new Error(`larger than ${maxBytes} bytes`);
	if (Number(response.headers.get("content-length")) > maxBytes)
		throw tooLarge();
	if (response.body === null) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw tooLarge();
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	return bytes;
}

function httpDownloader(maxBytes: number): Downloader {
	return {
		async download(url) {
			const response = await fetch(url, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			if (!response.ok) throw new Error(`status ${response.status}`);
			return {
				bytes: await cappedBody(response, maxBytes),
				contentType:
					response.headers.get("content-type")?.split(";")[0]?.trim() ||
					"application/octet-stream",
			};
		},
	};
}

export function knowledgeHostFor(options: {
	store: KnowledgeStore;
	maxDownloadBytes: number;
	downloader?: Downloader;
	clock?: Clock;
	pdf?: PdfReader;
}): KnowledgeHost {
	return {
		store: options.store,
		downloader: options.downloader ?? httpDownloader(options.maxDownloadBytes),
		pdf: options.pdf ?? unpdfReader(MAX_PDF_PAGES),
		prompt: knowledgePrompt,
		clock: options.clock ?? systemClock,
	};
}
