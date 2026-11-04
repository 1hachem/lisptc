import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { PageView } from "./file-view.tsx";
import { Chips, Field, SourceValue } from "./read-only.tsx";

function usedText(used: number, lastUsed: number): string {
	if (used === 0) return "never recalled";
	const times = used === 1 ? "once" : `${String(used)} times`;
	return `recalled ${times}, last on ${new Date(lastUsed).toLocaleString()}`;
}

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
		<PageView title={`memories/${memoryKey}`}>
			{memory === undefined ? (
				<div className="text-dim">
					{memories === undefined ? "loading…" : `no memory named ${memoryKey}`}
				</div>
			) : (
				<div className="flex flex-col gap-4">
					<h1 className="break-words font-medium text-[15px] text-fg">
						{memory.key}
					</h1>
					<Field label="remembers">
						<SourceValue source={memory.body} />
					</Field>
					{memory.on !== undefined && (
						<Field label="comes back when">
							<SourceValue source={memory.on} />
						</Field>
					)}
					<Field label="linked memories">
						<Chips items={memory.links.map((link) => link.key)} />
					</Field>
					<Field label="use">
						<span className="text-dim">
							{usedText(memory.used, memory.lastUsed)}
						</span>
					</Field>
				</div>
			)}
		</PageView>
	);
}
