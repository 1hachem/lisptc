import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAttempt } from "../lib/attempt.ts";
import { saveAs } from "../lib/file-list.ts";
import {
	type KnowledgeViewer,
	knowledgeViewer,
	readsText,
	type StoredText,
	sendBlocked,
	type TextViewer,
} from "../lib/file-viewer.ts";
import { AudioPlayer } from "./audio-player.tsx";
import { FileView } from "./file-view.tsx";
import { Markdown } from "./markdown.tsx";

type MediaViewer = Exclude<KnowledgeViewer, TextViewer>;

function MediaFrame({ children }: { children: ReactNode }) {
	return (
		<div className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden border border-bg2 bg-bg1">
			{children}
		</div>
	);
}

const MEDIA: Record<MediaViewer, (name: string, url: string) => ReactNode> = {
	image: (name, url) => (
		<MediaFrame>
			<img
				src={url}
				alt={name}
				className="max-h-full max-w-full object-contain"
			/>
		</MediaFrame>
	),
	pdf: (name, url) => (
		<MediaFrame>
			<embed
				src={`${url}#view=FitH&navpanes=0`}
				type="application/pdf"
				title={name}
				className="absolute top-0 left-0 h-[200%] w-[200%] origin-top-left scale-50"
			/>
		</MediaFrame>
	),
	video: (_name, url) => (
		<MediaFrame>
			{
				// biome-ignore lint/a11y/useMediaCaption: an uploaded file carries no captions to offer
				<video src={url} controls className="h-full w-full object-contain" />
			}
		</MediaFrame>
	),
	audio: (name, url) => <AudioPlayer name={name} url={url} />,
	download: () => <div className="text-dim">no preview for this file type</div>,
};

const FILLS: ReadonlySet<KnowledgeViewer> = new Set(["image", "pdf", "video"]);

const TEXT: Record<TextViewer, (text: string) => ReactNode> = {
	markdown: (text) => <Markdown>{text}</Markdown>,
	text: (text) => (
		<pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>
	),
};

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`fetch failed (${response.status})`);
	return await response.text();
}

function useStoredText(
	url: string | undefined,
	viewer: KnowledgeViewer | undefined,
): StoredText {
	const { data, error } = useQuery({
		queryKey: ["knowledge-text", url],
		queryFn: () => fetchText(url ?? ""),
		enabled: url !== undefined && readsText(viewer),
		staleTime: Number.POSITIVE_INFINITY,
	});
	return { text: data, failure: error?.message };
}

function StoredBody({
	name,
	url,
	viewer,
	loaded,
}: {
	name: string;
	url: string | undefined;
	viewer: KnowledgeViewer | undefined;
	loaded: StoredText;
}) {
	if (url === undefined || viewer === undefined)
		return <div className="text-dim">this file is gone from storage</div>;
	if (!readsText(viewer)) return MEDIA[viewer](name, url);
	if (loaded.failure !== undefined)
		return (
			<div className="text-red">this file did not load: {loaded.failure}</div>
		);
	if (loaded.text === undefined)
		return <div className="text-dim">loading…</div>;
	return TEXT[viewer](loaded.text);
}

export function DownloadButton({ name, url }: { name: string; url: string }) {
	const { failure, attempt } = useAttempt(`download ${name}`);
	return (
		<button
			type="button"
			onClick={() => attempt(() => saveAs(name, url))}
			title={failure ?? undefined}
			className={failure ? "text-red" : "text-dim hover:text-fg"}
		>
			{failure ? "download failed" : "download"}
		</button>
	);
}

export interface StoredFileRow {
	name: string;
	contentType: string | null;
	url: string | null;
}

function useStored(file: StoredFileRow | null | undefined) {
	const url = file?.url ?? undefined;
	const viewer = file
		? knowledgeViewer(file.name, file.contentType)
		: undefined;
	const loaded = useStoredText(url, viewer);
	const fills = url !== undefined && viewer !== undefined && FILLS.has(viewer);
	return { url, viewer, loaded, fills };
}

function openedAs(
	folder: string,
	name: string,
	file: StoredFileRow | null | undefined,
	text: string | undefined,
) {
	if (!file) return undefined;
	return { path: `${folder}/${name}`, source: text ?? "" };
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
	const { url, viewer, loaded, fills } = useStored(file);

	return (
		<FileView
			file={openedAs(folder, name, file, loaded.text)}
			blocked={sendBlocked(viewer, loaded)}
			missing={file === undefined ? undefined : `no file named ${name}`}
			actions={
				url && (
					<>
						{actions}
						<DownloadButton name={name} url={url} />
					</>
				)
			}
			body={
				<StoredBody name={name} url={url} viewer={viewer} loaded={loaded} />
			}
			fill={fills}
		/>
	);
}
