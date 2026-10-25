import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { memorySource } from "../lib/files.ts";
import { FileView } from "./file-view.tsx";

export function MemoryPage({
	workspaceId,
	memoryKey,
}: {
	workspaceId: Id<"workspaces">;
	memoryKey: string;
}) {
	const { data: memories, error } = useQuery(
		convexQuery(api.memories.list, { workspaceId }),
	);
	if (error) throw error;
	const memory = memories?.find((candidate) => candidate.key === memoryKey);

	return (
		<FileView
			file={
				memory && {
					path: `memories/${memoryKey}`,
					source: memorySource(memory),
				}
			}
			missing={
				memories === undefined ? undefined : `no memory named ${memoryKey}`
			}
		/>
	);
}
