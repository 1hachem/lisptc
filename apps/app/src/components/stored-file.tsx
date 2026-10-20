import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { type KnowledgeViewer, knowledgeViewer } from "../lib/knowledge.ts";
import { FileView } from "./file-view.tsx";
import { Markdown } from "./markdown.tsx";

type TextViewer = Extract<KnowledgeViewer, "markdown" | "text">;
type MediaViewer = Exclude<KnowledgeViewer, TextViewer>;

const MEDIA: Record<MediaViewer, (name: string, url: string) => ReactNode> = {
	image: (name, url) => (
		<img src={url} alt={name} className="max-w-full self-start" />
	),
	pdf: (_name, url) => (
		<div className="relative h-[65vh] min-h-80 w-full overflow-hidden rounded-sm border border-bg2">
			<embed
				src={`${url}#view=FitH&navpanes=0`}
				type="application/pdf"
				title="PDF Viewer"
				className="absolute top-0 left-0 h-[200%] w-[200%] origin-top-left scale-50"
			/>
		</div>
	),
	video: (_name, url) => (
		// biome-ignore lint/a11y/useMediaCaption: an uploaded file carries no captions to offer
		<video src={url} controls className="w-full" />
	),
	audio: (_name, url) => (
		// biome-ignore lint/a11y/useMediaCaption: an uploaded file carries no captions to offer
		<audio src={url} controls className="w-full" />
	),
	download: () => <div className="text-dim">no preview for this file type</div>,
};

const TEXT: Record<TextViewer, (text: string) => ReactNode> = {
	markdown: (text) => <Markdown>{text}</Markdown>,
	text: (text) => (
		<pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>
	),
};

function readsText(viewer: KnowledgeViewer | undefined): viewer is TextViewer {
	return viewer === "markdown" || viewer === "text";
}

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`fetch failed (${response.status})`);
	return await response.text();
}

function useStoredText(
	url: string | undefined,
	viewer: KnowledgeViewer | undefined,
): string | undefined {
	const { data } = useQuery({
		queryKey: ["knowledge-text", url],
		queryFn: () => fetchText(url ?? ""),
		enabled: url !== undefined && readsText(viewer),
		staleTime: Number.POSITIVE_INFINITY,
	});
	return data;
}

function StoredBody({
	name,
	url,
	viewer,
	text,
}: {
	name: string;
	url: string | undefined;
	viewer: KnowledgeViewer | undefined;
	text: string | undefined;
}) {
	if (url === undefined || viewer === undefined)
		return <div className="text-dim">this file is gone from storage</div>;
	if (!readsText(viewer)) return MEDIA[viewer](name, url);
	if (text === undefined) return <div className="text-dim">loading…</div>;
	return TEXT[viewer](text);
}

function DownloadLink({ name, url }: { name: string; url: string }) {
	return (
		<a
			href={url}
			download={name}
			target="_blank"
			rel="noreferrer"
			className="text-dim hover:text-fg"
		>
			download
		</a>
	);
}

export interface StoredFileRow {
	name: string;
	contentType: string | null;
	url: string | null;
}

export function StoredFile({
	folder,
	name,
	file,
	actions,
}: {
	folder: string;
	name: string;
	file: StoredFileRow | null | undefined;
	actions?: ReactNode;
}) {
	const url = file?.url ?? undefined;
	const viewer = file
		? knowledgeViewer(file.name, file.contentType)
		: undefined;
	const text = useStoredText(url, viewer);

	return (
		<FileView
			file={
				file ? { path: `${folder}/${name}`, source: text ?? "" } : undefined
			}
			missing={file === undefined ? undefined : `no file named ${name}`}
			actions={
				url && (
					<>
						{actions}
						<DownloadLink name={name} url={url} />
					</>
				)
			}
			body={<StoredBody name={name} url={url} viewer={viewer} text={text} />}
		/>
	);
}
