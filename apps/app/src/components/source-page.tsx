import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { FileView } from "./file-view.tsx";

export function SourcePage({
	workspaceId,
	folder,
	name,
}: {
	workspaceId: Id<"workspaces">;
	folder: string;
	name: string;
}) {
	const path = `${folder}/${name}`;
	const { data: text, error } = useQuery(
		convexQuery(api.sources.get, { workspaceId, folder, name }),
	);
	if (error) throw error;

	return (
		<FileView
			file={typeof text === "string" ? { path, source: text } : undefined}
			missing={text === null ? `no ${path}` : undefined}
		/>
	);
}
