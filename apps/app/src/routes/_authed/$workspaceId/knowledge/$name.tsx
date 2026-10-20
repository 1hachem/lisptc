import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
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

const READS_TEXT: ReadonlySet<KnowledgeViewer> = new Set(["markdown", "text"]);

function KnowledgeBody({
	name,
	url,
	viewer,
	text,
}: {
	name: string;
	url: string;
	viewer: KnowledgeViewer;
	text: string | undefined;
}) {
	switch (viewer) {
		case "image":
			return <img src={url} alt={name} className="max-w-full self-start" />;
		case "pdf":
			return (
				<iframe
					src={url}
					title={name}
					className="h-[75vh] w-full border border-bg2"
				/>
			);
		case "video":
			// biome-ignore lint/a11y/useMediaCaption: an uploaded file carries no captions to offer
			return <video src={url} controls className="w-full" />;
		case "audio":
			// biome-ignore lint/a11y/useMediaCaption: an uploaded file carries no captions to offer
			return <audio src={url} controls className="w-full" />;
		case "markdown":
			return text === undefined ? (
				<div className="text-dim">loading…</div>
			) : (
				<Markdown>{text}</Markdown>
			);
		case "text":
			return text === undefined ? (
				<div className="text-dim">loading…</div>
			) : (
				<pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>
			);
		case "download":
			return <div className="text-dim">no preview for this file type</div>;
	}
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
	const { data: text } = useQuery({
		queryKey: ["knowledge-text", url],
		queryFn: async () => {
			const response = await fetch(url ?? "");
			if (!response.ok) throw new Error(`fetch failed (${response.status})`);
			return await response.text();
		},
		enabled:
			url !== undefined && viewer !== undefined && READS_TEXT.has(viewer),
		staleTime: Number.POSITIVE_INFINITY,
	});

	return (
		<FileView
			file={
				file ? { path: `knowledge/${name}`, source: text ?? "" } : undefined
			}
			missing={file === undefined ? undefined : `no file named ${name}`}
			actions={
				url && (
					<a
						href={url}
						download={name}
						target="_blank"
						rel="noreferrer"
						className="text-dim hover:text-fg"
					>
						download
					</a>
				)
			}
			body={
				url && viewer ? (
					<KnowledgeBody name={name} url={url} viewer={viewer} text={text} />
				) : (
					<div className="text-dim">this file is gone from storage</div>
				)
			}
		/>
	);
}
