import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { mistralApiEnv } from "@repo/env/mcps/mistral/api";

export class OcrConfigError extends Error {}

export interface OcrPage {
	index: number;
	markdown: string;
}

const IMAGE_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".webp",
	".gif",
	".tif",
	".tiff",
	".bmp",
]);

async function mistral<T>(path: string, init: RequestInit): Promise<T> {
	const res = await fetch(`${mistralApiEnv.MISTRAL_BASE_URL}${path}`, {
		...init,
		headers: {
			...init.headers,
			Authorization: `Bearer ${mistralApiEnv.MISTRAL_API_KEY}`,
		},
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Mistral API error (HTTP ${res.status}): ${text}`);
	}
	return (text ? JSON.parse(text) : {}) as T;
}

async function uploadForOcr(path: string): Promise<string> {
	const form = new FormData();
	form.append("purpose", "ocr");
	form.append("file", new Blob([await readFile(path)]), basename(path));
	const { id } = await mistral<{ id: string }>("/files", {
		method: "POST",
		body: form,
	});
	const { url } = await mistral<{ url: string }>(`/files/${id}/url?expiry=1`, {
		method: "GET",
	});
	return url;
}

function documentFor(url: string, isImage: boolean) {
	return isImage
		? { type: "image_url", image_url: url }
		: { type: "document_url", document_url: url };
}

export async function ocr(params: {
	url?: string;
	path?: string;
	pages?: number[];
	model: string;
}): Promise<{
	model: string;
	source: string;
	pageCount: number;
	pages: OcrPage[];
}> {
	if (!params.url === !params.path) {
		throw new OcrConfigError("Pass exactly one of url or path.");
	}
	const source = (params.url ?? params.path) as string;
	const isImage = IMAGE_EXTENSIONS.has(
		extname(new URL(source, "file:///").pathname).toLowerCase(),
	);
	const target = params.path ? await uploadForOcr(params.path) : source;

	const body: Record<string, unknown> = {
		model: params.model,
		document: documentFor(target, isImage),
		include_image_base64: false,
	};
	if (params.pages?.length) body.pages = params.pages;

	const result = await mistral<{
		model?: string;
		pages?: { index?: number; markdown?: string }[];
	}>("/ocr", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	const pages = (result.pages ?? []).map((page, i) => ({
		index: page.index ?? i,
		markdown: page.markdown ?? "",
	}));

	return {
		model: result.model ?? params.model,
		source,
		pageCount: pages.length,
		pages,
	};
}
