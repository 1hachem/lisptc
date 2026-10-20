import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { StoredFile } from "../../../../components/stored-file.tsx";

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

const RESTORE_FAILURES: Record<string, string> = {
	NO_SUCH_FILE: "it is no longer in the bin",
	TOO_MANY_FILES: "attachments are full",
};

function RestoreAction({
	workspaceId,
	name,
}: {
	workspaceId: Id<"workspaces">;
	name: string;
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
					const refused = await restore({ workspaceId, name });
					if (refused !== null) {
						setFailure(RESTORE_FAILURES[refused] ?? refused);
						return;
					}
					await navigate({
						to: "/$workspaceId/attachments/$name",
						params: { workspaceId, name },
						replace: true,
					});
				}}
			>
				restore to attachments
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
			actions={<RestoreAction workspaceId={workspaceId} name={name} />}
		/>
	);
}
