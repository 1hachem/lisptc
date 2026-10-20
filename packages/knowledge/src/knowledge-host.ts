import { filePrompt } from "@repo/shared/host-node";
import type { Downloader, KnowledgeHost, KnowledgeStore } from "./ports.ts";

const knowledgePrompt = filePrompt(new URL("./knowledge.ptc", import.meta.url));

const FETCH_TIMEOUT_MS = 30_000;

const httpDownloader: Downloader = {
	async download(url) {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!response.ok) throw new Error(`status ${response.status}`);
		return {
			bytes: new Uint8Array(await response.arrayBuffer()),
			contentType:
				response.headers.get("content-type")?.split(";")[0]?.trim() ||
				"application/octet-stream",
		};
	},
};

export function knowledgeHostFor(options: {
	store: KnowledgeStore;
	downloader?: Downloader;
}): KnowledgeHost {
	return {
		store: options.store,
		downloader: options.downloader ?? httpDownloader,
		prompt: knowledgePrompt,
	};
}
