import { convexQuery } from "@convex-dev/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense } from "react";
import {
	type KnowledgeViewer,
	knowledgeIcon,
	knowledgeViewer,
} from "../lib/knowledge.ts";
import { AudioPlayer } from "./audio-player.tsx";
import { FileView } from "./file-view.tsx";
import { Markdown } from "./markdown.tsx";

const StlViewer = lazy(async () => ({
	default: (await import("@repo/components/stl-viewer.tsx")).StlViewer,
}));

type TextViewer = Extract<KnowledgeViewer, "markdown" | "text">;
type MediaViewer = Exclude<KnowledgeViewer, TextViewer>;

function NoPreview({ name, url }: { name: string; url: string }) {
	const dot = name.lastIndexOf(".");
	const kind =
		dot > 0 ? `.${name.slice(dot + 1).toLowerCase()} files` : "this file";
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 text-dim">
			<HugeiconsIcon icon={knowledgeIcon(name, null)} className="size-icon" />
			<span className="max-w-full truncate text-fg">{name}</span>
			<span>no preview for {kind} yet</span>
			<a
				href={url}
				download={name}
				target="_blank"
				rel="noreferrer"
				className="hover:text-fg"
			>
				download
			</a>
		</div>
	);
}

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
	stl: (name, url) => (
		<MediaFrame>
			<Suspense fallback={<div className="text-dim">loading…</div>}>
				<StlViewer url={url} name={name} />
			</Suspense>
		</MediaFrame>
	),
	download: (name, url) => <NoPreview name={name} url={url} />,
};

const FILLS: ReadonlySet<KnowledgeViewer> = new Set([
	"image",
	"pdf",
	"video",
	"stl",
	"download",
]);

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

function useStored(file: StoredFileRow | null | undefined) {
	const url = file?.url ?? undefined;
	const viewer = file
		? knowledgeViewer(file.name, file.contentType)
		: undefined;
	const text = useStoredText(url, viewer);
	const fills = url !== undefined && viewer !== undefined && FILLS.has(viewer);
	return { url, viewer, text, fills };
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

export function FilePreview({
	workspaceId,
	folder,
	name,
}: {
	workspaceId: Id<"workspaces">;
	folder: "attachments" | "knowledge";
	name: string;
}) {
	const { data: file, error } = useQuery(
		convexQuery(
			folder === "knowledge" ? api.knowledge.get : api.attachments.get,
			{
				workspaceId,
				name,
			},
		),
	);
	const { url, viewer, text, fills } = useStored(file);
	if (error) return <div className="p-3 text-dim">{error.message}</div>;
	if (file === undefined) return <div className="p-3 text-dim">loading…</div>;
	if (file === null)
		return (
			<div className="p-3 text-dim">
				no file named {name} in {folder}
			</div>
		);
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-row flex-none items-center justify-between gap-2 px-3 text-dim">
				<span className="truncate">
					{folder}/{name}
				</span>
				{url && <DownloadLink name={name} url={url} />}
			</div>
			<div
				className={
					fills
						? "flex min-h-0 flex-1 flex-col px-3 pb-3"
						: "min-h-0 flex-1 overflow-auto px-3 pb-3"
				}
			>
				<StoredBody name={name} url={url} viewer={viewer} text={text} />
			</div>
		</div>
	);
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
	const { url, viewer, text, fills } = useStored(file);

	return (
		<FileView
			file={openedAs(folder, name, file, text)}
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
			fill={fills}
		/>
	);
}
