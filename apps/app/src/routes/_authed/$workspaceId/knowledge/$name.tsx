import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { FileView } from "../../../../components/file-view.tsx";
import { Markdown } from "../../../../components/markdown.tsx";
import {
	type KnowledgeViewer,
	knowledgeViewer,
} from "../../../../lib/knowledge.ts";

export const Route = createFileRoute("/_authed/$workspaceId/knowledge/$name")({
	loader: async ({ context, params }) => {
		if (context.auth.source === "browser") return;
		await context.queryClient.ensureQueryData(
			convexQuery(api.knowledge.get, {
				workspaceId: params.workspaceId,
				name: params.name,
			}),
		);
	},
	component: KnowledgeFile,
});

type TextViewer = Extract<KnowledgeViewer, "markdown" | "text">;
type MediaViewer = Exclude<KnowledgeViewer, TextViewer>;

const MEDIA: Record<MediaViewer, (name: string, url: string) => ReactNode> = {
	image: (name, url) => (
		<img src={url} alt={name} className="max-w-full self-start" />
	),
	pdf: (_name, url) => (
		<embed
			src={`${url}#view=FitH`}
			type="application/pdf"
			title="PDF Viewer"
			className="h-[calc(100vh-10rem)] min-h-96 w-full rounded-sm border border-bg2"
		/>
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

function useKnowledgeText(
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

function KnowledgeBody({
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

function KnowledgeFile() {
	const { workspaceId, name } = Route.useParams();
	const { data: file, error } = useQuery(
		convexQuery(api.knowledge.get, { workspaceId, name }),
	);
	if (error) throw error;
	const url = file?.url ?? undefined;
	const viewer = file
		? knowledgeViewer(file.name, file.contentType)
		: undefined;
	const text = useKnowledgeText(url, viewer);

	return (
		<FileView
			file={
				file ? { path: `knowledge/${name}`, source: text ?? "" } : undefined
			}
			missing={file === undefined ? undefined : `no file named ${name}`}
			actions={url && <DownloadLink name={name} url={url} />}
			body={<KnowledgeBody name={name} url={url} viewer={viewer} text={text} />}
		/>
	);
}
