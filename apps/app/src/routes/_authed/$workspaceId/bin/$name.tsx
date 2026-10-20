import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { StoredFile } from "../../../../components/stored-file.tsx";
import { restoreFailure } from "../../../../lib/bin.ts";

export const Route = createFileRoute("/_authed/$workspaceId/bin/$name")({
	loader: async ({ context, params }) => {
		if (context.auth.source === "browser") return;
		await context.queryClient.ensureQueryData(
			convexQuery(api.bin.get, {
				workspaceId: params.workspaceId,
				name: params.name,
			}),
		);
	},
	component: BinnedFile,
});

function RestoreAction({
	workspaceId,
	name,
	from,
}: {
	workspaceId: Id<"workspaces">;
	name: string;
	from: "knowledge" | "attachments";
}) {
	const restore = useConvexMutation(api.bin.restore);
	const navigate = useNavigate();
	const [failure, setFailure] = useState<string | null>(null);
	return (
		<>
			{failure && <span className="text-red">{failure}</span>}
			<button
				type="button"
				className="text-dim hover:text-fg"
				onClick={async () => {
					const restored = await restore({ workspaceId, name });
					if ("refused" in restored) {
						setFailure(restoreFailure(restored.refused));
						return;
					}
					await navigate({
						to:
							restored.folder === "knowledge"
								? "/$workspaceId/knowledge/$name"
								: "/$workspaceId/attachments/$name",
						params: { workspaceId, name: restored.name },
						replace: true,
					});
				}}
			>
				restore to {from}
			</button>
		</>
	);
}

function BinnedFile() {
	const { workspaceId, name } = Route.useParams();
	const { data: file, error } = useQuery(
		convexQuery(api.bin.get, { workspaceId, name }),
	);
	if (error) throw error;
	return (
		<StoredFile
			folder="bin"
			name={name}
			file={file}
			actions={
				file && (
					<RestoreAction
						workspaceId={workspaceId}
						name={name}
						from={file.from}
					/>
				)
			}
		/>
	);
}
