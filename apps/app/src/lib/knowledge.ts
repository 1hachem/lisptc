import { useConvexMutation } from "@convex-dev/react-query";
import {
	CssFile01Icon,
	Csv01Icon,
	Doc01Icon,
	DocumentCodeIcon,
	File01Icon,
	FileArchiveIcon,
	FileAudioIcon,
	FileBracesIcon,
	FileImageIcon,
	FileTextIcon,
	FileVideoIcon,
	Gif01Icon,
	HtmlFile01Icon,
	JavaScriptIcon,
	Jpg01Icon,
	Mp301Icon,
	Pdf01Icon,
	Png01Icon,
	Ppt01Icon,
	PythonIcon,
	Rar01Icon,
	SqlIcon,
	Svg01Icon,
	Txt01Icon,
	TypescriptIcon,
	Xls01Icon,
	Xml01Icon,
	Zip01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { MAX_KNOWLEDGE_BYTES } from "@repo/backend/limits";
import { ConvexError } from "convex/values";
import { useCallback, useState } from "react";

const EXTENSION_ICONS: Record<string, IconSvgElement> = {
	pdf: Pdf01Icon,
	doc: Doc01Icon,
	docx: Doc01Icon,
	odt: Doc01Icon,
	rtf: Doc01Icon,
	xls: Xls01Icon,
	xlsx: Xls01Icon,
	ods: Xls01Icon,
	csv: Csv01Icon,
	tsv: Csv01Icon,
	ppt: Ppt01Icon,
	pptx: Ppt01Icon,
	odp: Ppt01Icon,
	txt: Txt01Icon,
	log: Txt01Icon,
	md: FileTextIcon,
	markdown: FileTextIcon,
	json: FileBracesIcon,
	yaml: FileBracesIcon,
	yml: FileBracesIcon,
	toml: FileBracesIcon,
	xml: Xml01Icon,
	html: HtmlFile01Icon,
	htm: HtmlFile01Icon,
	css: CssFile01Icon,
	js: JavaScriptIcon,
	mjs: JavaScriptIcon,
	jsx: JavaScriptIcon,
	ts: TypescriptIcon,
	tsx: TypescriptIcon,
	py: PythonIcon,
	sql: SqlIcon,
	ptc: DocumentCodeIcon,
	jpg: Jpg01Icon,
	jpeg: Jpg01Icon,
	png: Png01Icon,
	gif: Gif01Icon,
	svg: Svg01Icon,
	zip: Zip01Icon,
	rar: Rar01Icon,
	tar: FileArchiveIcon,
	gz: FileArchiveIcon,
	"7z": FileArchiveIcon,
	mp3: Mp301Icon,
};

const KIND_ICONS: Record<string, IconSvgElement> = {
	image: FileImageIcon,
	video: FileVideoIcon,
	audio: FileAudioIcon,
	text: FileTextIcon,
};

const TEXT_EXTENSIONS = new Set([
	"txt",
	"log",
	"csv",
	"tsv",
	"json",
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

function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function knowledgeIcon(
	name: string,
	contentType: string | null,
): IconSvgElement {
	return (
		EXTENSION_ICONS[extensionOf(name)] ??
		KIND_ICONS[contentType?.split("/")[0] ?? ""] ??
		File01Icon
	);
}

export type KnowledgeViewer =
	| "image"
	| "pdf"
	| "video"
	| "audio"
	| "markdown"
	| "text"
	| "download";

export function knowledgeViewer(
	name: string,
	contentType: string | null,
): KnowledgeViewer {
	const extension = extensionOf(name);
	const type = contentType ?? "";
	if (type.startsWith("image/")) return "image";
	if (type === "application/pdf" || extension === "pdf") return "pdf";
	if (type.startsWith("video/")) return "video";
	if (type.startsWith("audio/")) return "audio";
	if (
		type === "text/markdown" ||
		extension === "md" ||
		extension === "markdown"
	)
		return "markdown";
	if (
		type.startsWith("text/") ||
		type === "application/json" ||
		TEXT_EXTENSIONS.has(extension)
	)
		return "text";
	return "download";
}

const UPLOAD_FAILURES: Record<string, string> = {
	BAD_KNOWLEDGE_NAME: "a name with no slashes, not starting with a dot",
	FILE_TOO_LARGE: `over the ${MAX_KNOWLEDGE_BYTES / 1_048_576} MB limit`,
	TOO_MANY_FILES: "the folder is full",
	FORBIDDEN: "no access to this workspace",
};

function uploadFailure(name: string, error: unknown): string {
	const code =
		error instanceof ConvexError &&
		typeof error.data === "object" &&
		error.data !== null &&
		"code" in error.data
			? String(error.data.code)
			: undefined;
	const reason =
		(code !== undefined && UPLOAD_FAILURES[code]) ||
		(error instanceof Error ? error.message : "unknown error");
	return `${name} not uploaded: ${reason}`;
}

async function stored(url: string, file: File): Promise<Id<"_storage">> {
	if (file.size > MAX_KNOWLEDGE_BYTES)
		throw new ConvexError({ code: "FILE_TOO_LARGE" });
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": file.type || "application/octet-stream" },
		body: file,
	});
	if (!response.ok) throw new Error(`upload failed (${response.status})`);
	const { storageId } = (await response.json()) as {
		storageId: Id<"_storage">;
	};
	return storageId;
}

export function useAttachmentUpload(workspaceId: Id<"workspaces">) {
	const uploadUrl = useConvexMutation(api.knowledge.uploadUrl);
	const add = useConvexMutation(api.attachments.add);
	const remove = useConvexMutation(api.attachments.discard);

	const upload = useCallback(
		async (file: File): Promise<string> => {
			try {
				const storageId = await stored(await uploadUrl({ workspaceId }), file);
				const added = await add({
					workspaceId,
					name: file.name,
					storageId,
					contentType: file.type,
				});
				if ("refused" in added) throw new ConvexError({ code: added.refused });
				return added.name;
			} catch (error) {
				throw new Error(uploadFailure(file.name, error));
			}
		},
		[uploadUrl, add, workspaceId],
	);

	const discard = useCallback(
		(name: string) => {
			void remove({ workspaceId, name });
		},
		[remove, workspaceId],
	);

	return { upload, discard };
}

export function useKnowledgeUpload(workspaceId: Id<"workspaces">) {
	const uploadUrl = useConvexMutation(api.knowledge.uploadUrl);
	const add = useConvexMutation(api.knowledge.add);
	const [uploading, setUploading] = useState<string[]>([]);
	const [failures, setFailures] = useState<string[]>([]);

	const uploadOne = async (file: File) => {
		const storageId = await stored(await uploadUrl({ workspaceId }), file);
		const refused = await add({
			workspaceId,
			name: file.name,
			storageId,
			contentType: file.type,
		});
		if (refused !== null) throw new ConvexError({ code: refused });
	};

	const upload = async (files: Iterable<File>) => {
		const picked = [...files];
		setFailures([]);
		setUploading(picked.map((file) => file.name));
		const settled = await Promise.allSettled(picked.map(uploadOne));
		setUploading([]);
		setFailures(
			settled.flatMap((result, index) =>
				result.status === "rejected"
					? [uploadFailure(picked[index].name, result.reason)]
					: [],
			),
		);
	};

	return { upload, uploading, failures };
}
