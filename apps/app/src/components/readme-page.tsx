import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { MAX_README_BYTES } from "@repo/backend/limits";
import { useQuery } from "@tanstack/react-query";
import { ConvexError } from "convex/values";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileView } from "./file-view.tsx";
import { MarkdownEditor } from "./markdown-editor.tsx";

const SAVE_DELAY_MS = 500;

const SAVE_FAILURES: Record<string, string> = {
	README_TOO_LARGE: `not saved: over the ${MAX_README_BYTES / 1024} KB limit`,
	UNAUTHENTICATED: "not saved: signed out, sign in again",
	NOT_PROVISIONED: "not saved: your account is still being set up",
	FORBIDDEN: "not saved: no access to this workspace",
};

function saveFailure(error: unknown): string {
	const code =
		error instanceof ConvexError &&
		typeof error.data === "object" &&
		error.data !== null &&
		"code" in error.data
			? String(error.data.code)
			: undefined;
	if (code !== undefined && code in SAVE_FAILURES) return SAVE_FAILURES[code];
	return `not saved: ${error instanceof Error ? error.message : "unknown error"}`;
}

export function ReadmePage({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
	const { data: stored } = useQuery(
		convexQuery(api.readmes.get, { workspaceId }),
	);
	const put = useConvexMutation(api.readmes.put);
	const [state, setState] = useState("saved");
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
		} catch (error) {
			setState(saveFailure(error));
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
