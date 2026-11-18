import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { PageView } from "./file-view.tsx";
import { LispSource } from "./lisp-text.tsx";
import { Field } from "./read-only.tsx";

export function GraphPage({
	workspaceId,
	name,
}: {
	workspaceId: Id<"workspaces">;
	name: string;
}) {
	const { data: graphs, error } = useQuery(
		convexQuery(api.graphs.list, { workspaceId }),
	);
	if (error) throw error;
	const graph = graphs?.find((candidate) => candidate.name === name);

	return (
		<PageView title={`graphs/${name}`}>
			{graph === undefined ? (
				<div className="text-dim">
					{graphs === undefined ? "loading…" : `no graph named ${name}`}
				</div>
			) : (
				<div className="flex flex-col gap-4">
					<h1 className="break-words font-medium text-[15px] text-fg">
						{graph.name}
					</h1>
					<Field label="updated">
						<span className="text-dim">
							{new Date(graph.updatedAt).toLocaleString()}
						</span>
					</Field>
					<LispSource>{graph.source}</LispSource>
				</div>
			)}
		</PageView>
	);
}
