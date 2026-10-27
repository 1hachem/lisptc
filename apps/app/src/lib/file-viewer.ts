import { queryOptions } from "@tanstack/react-query";

const TEXT_EXTENSIONS = new Set([
	"txt",
	"log",
	"csv",
	"tsv",
	"yaml",
	"yml",
	"toml",
	"xml",
	"html",
	"htm",
	"css",
	"js",
	"mjs",
	"jsx",
	"ts",
	"tsx",
	"py",
	"sql",
	"ptc",
]);

export function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export type KnowledgeViewer =
	| "image"
	| "pdf"
	| "video"
	| "audio"
	| "stl"
	| "markdown"
	| "json"
	| "text"
	| "download";

export type TextViewer = Extract<KnowledgeViewer, "markdown" | "json" | "text">;

export function readsText(
	viewer: KnowledgeViewer | undefined,
): viewer is TextViewer {
	return viewer === "markdown" || viewer === "json" || viewer === "text";
}

export interface StoredText {
	text?: string;
	failure?: string;
}

export function sendBlocked(
	viewer: KnowledgeViewer | undefined,
	loaded: StoredText,
): string | undefined {
	if (!readsText(viewer)) return undefined;
	if (loaded.failure !== undefined)
		return "the file did not load, so there is nothing to ask about";
	if (loaded.text === undefined)
		return "the file is still loading, send once it shows";
	return undefined;
}

export function knowledgeViewer(
	name: string,
	contentType: string | null,
): KnowledgeViewer {
	const extension = extensionOf(name);
	const type = contentType ?? "";
	if (extension === "dwg" || type === "image/vnd.dwg") return "download";
	if (type.startsWith("image/")) return "image";
	if (type === "application/pdf" || extension === "pdf") return "pdf";
	if (type.startsWith("video/")) return "video";
	if (type.startsWith("audio/")) return "audio";
	if (type === "model/stl" || extension === "stl") return "stl";
	if (
		type === "text/markdown" ||
		extension === "md" ||
		extension === "markdown"
	)
		return "markdown";
	if (
		type === "application/json" ||
		type.endsWith("+json") ||
		extension === "json"
	)
		return "json";
	if (type.startsWith("text/") || TEXT_EXTENSIONS.has(extension)) return "text";
	return "download";
}

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`fetch failed (${response.status})`);
	return await response.text();
}

export function storedTextQuery(url: string) {
	return queryOptions({
		queryKey: ["knowledge-text", url],
		queryFn: () => fetchText(url),
		staleTime: Number.POSITIVE_INFINITY,
	});
}
