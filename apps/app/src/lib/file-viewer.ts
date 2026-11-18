import { queryOptions } from "@tanstack/react-query";

const TEXT_EXTENSIONS = [
	"txt",
	"log",
	"csv",
	"tsv",
	"yaml",
	"yml",
	"toml",
	"xml",
	"css",
	"js",
	"mjs",
	"jsx",
	"ts",
	"tsx",
	"py",
	"sql",
];

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
	| "svg"
	| "html"
	| "markdown"
	| "json"
	| "lisptc"
	| "text"
	| "download";

export type TextViewer = Extract<
	KnowledgeViewer,
	"svg" | "html" | "markdown" | "json" | "lisptc" | "text"
>;

export function readsText(
	viewer: KnowledgeViewer | undefined,
): viewer is TextViewer {
	return (
		viewer === "svg" ||
		viewer === "html" ||
		viewer === "markdown" ||
		viewer === "json" ||
		viewer === "lisptc" ||
		viewer === "text"
	);
}

export interface StoredText {
	text?: string;
	failure?: string;
}

interface ViewerRule {
	viewer: KnowledgeViewer;
	extensions: readonly string[];
	type: (type: string) => boolean;
}

const VIEWER_RULES: readonly ViewerRule[] = [
	{
		viewer: "download",
		extensions: ["dwg"],
		type: (type) => type === "image/vnd.dwg",
	},
	{
		viewer: "svg",
		extensions: ["svg"],
		type: (type) => type === "image/svg+xml",
	},
	{
		viewer: "image",
		extensions: [],
		type: (type) => type.startsWith("image/"),
	},
	{
		viewer: "html",
		extensions: ["html", "htm"],
		type: (type) => type === "text/html",
	},
	{
		viewer: "pdf",
		extensions: ["pdf"],
		type: (type) => type === "application/pdf",
	},
	{
		viewer: "video",
		extensions: [],
		type: (type) => type.startsWith("video/"),
	},
	{
		viewer: "audio",
		extensions: [],
		type: (type) => type.startsWith("audio/"),
	},
	{ viewer: "stl", extensions: ["stl"], type: (type) => type === "model/stl" },
	{
		viewer: "markdown",
		extensions: ["md", "markdown"],
		type: (type) => type === "text/markdown",
	},
	{
		viewer: "json",
		extensions: ["json"],
		type: (type) => type === "application/json" || type.endsWith("+json"),
	},
	{ viewer: "lisptc", extensions: ["ptc"], type: () => false },
	{
		viewer: "text",
		extensions: TEXT_EXTENSIONS,
		type: (type) => type.startsWith("text/"),
	},
];

export function knowledgeViewer(
	name: string,
	contentType: string | null,
): KnowledgeViewer {
	const extension = extensionOf(name);
	const type = contentType ?? "";
	const rule = VIEWER_RULES.find(
		(candidate) =>
			candidate.extensions.includes(extension) || candidate.type(type),
	);
	return rule?.viewer ?? "download";
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
