import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileView } from "../../../components/file-view.tsx";
import { MarkdownEditor } from "../../../components/markdown-editor.tsx";

export const Route = createFileRoute("/_authed/$workspaceId/readme")({
	loader: async ({ context, params }) => {
		await context.queryClient.ensureQueryData(
			convexQuery(api.readmes.get, { workspaceId: params.workspaceId }),
		);
	},
	component: ReadmeFile,
});

const SAVE_DELAY_MS = 500;

type SaveState = "saved" | "saving" | "too large to save";

function ReadmeFile() {
	const { workspaceId } = Route.useParams();
	const { data: stored } = useQuery(
		convexQuery(api.readmes.get, { workspaceId }),
	);
	const put = useConvexMutation(api.readmes.put);
	const [state, setState] = useState<SaveState>("saved");
	const [written, setWritten] = useState<string | null>(null);
	const pending = useRef<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const flush = useCallback(async () => {
		clearTimeout(timer.current);
		const body = pending.current;
		if (body === null) return;
		pending.current = null;
		try {
			await put({ workspaceId, body });
			setState("saved");
		} catch {
			setState("too large to save");
		}
	}, [put, workspaceId]);

	useEffect(() => () => void flush(), [flush]);

	const text = written ?? stored ?? "";

	return (
		<FileView
			file={
				stored === undefined
					? undefined
					: { path: "README.md", source: text, language: "markdown" }
			}
			actions={<span className="flex-none">{state}</span>}
			body={
				<MarkdownEditor
					value={stored ?? ""}
					onChange={(markdown) => {
						setWritten(markdown);
						pending.current = markdown;
						setState("saving");
						clearTimeout(timer.current);
						timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
					}}
					onBlur={() => void flush()}
					label="README.md"
					placeholder="write markdown…"
				/>
			}
		/>
	);
}
