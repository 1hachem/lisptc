import { filePrompt } from "@repo/shared/host-node";
import type { Downloader, KnowledgeHost, KnowledgeStore } from "./ports.ts";

const knowledgePrompt = filePrompt(new URL("./knowledge.ptc", import.meta.url));

const FETCH_TIMEOUT_MS = 30_000;

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
}): KnowledgeHost {
	return {
		store: options.store,
		downloader: options.downloader ?? httpDownloader(options.maxDownloadBytes),
		prompt: knowledgePrompt,
	};
}
