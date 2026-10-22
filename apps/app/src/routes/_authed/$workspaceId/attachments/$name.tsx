import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { StoredFile } from "../../../../components/stored-file.tsx";

export const Route = createFileRoute("/_authed/$workspaceId/attachments/$name")(
	{
		loader: async ({ context, params }) => {
			if (context.auth.source === "browser") return;
			await context.queryClient.ensureQueryData(
				convexQuery(api.files.get, {
					workspaceId: params.workspaceId,
					folder: "attachments",
					name: params.name,
				}),
			);
		},
		component: AttachmentFile,
	},
);

const KEEP_FAILURES: Record<string, string> = {
	NO_SUCH_FILE: "it is no longer in attachments",
	NAME_TAKEN: "knowledge already holds a file of that name",
	TOO_MANY_FILES: "the knowledge folder is full",
};

function KeepAction({
	workspaceId,
	name,
}: {
	workspaceId: Id<"workspaces">;
	name: string;
}) {
	const keep = useConvexMutation(api.files.keep);
	const navigate = useNavigate();
	const [failure, setFailure] = useState<string | null>(null);
	return (
		<>
			{failure && <span className="text-red">{failure}</span>}
			<button
				type="button"
				className="text-dim hover:text-fg"
				onClick={async () => {
					const refused = await keep({ workspaceId, name });
					if (refused !== null) {
						setFailure(KEEP_FAILURES[refused] ?? refused);
						return;
					}
					await navigate({
						to: "/$workspaceId/knowledge/$name",
						params: { workspaceId, name },
						replace: true,
					});
				}}
			>
				keep in knowledge
			</button>
		</>
	);
}

function AttachmentFile() {
	const { workspaceId, name } = Route.useParams();
	const { data: file, error } = useQuery(
		convexQuery(api.files.get, { workspaceId, folder: "attachments", name }),
	);
	if (error) throw error;
	return (
		<StoredFile
			folder="attachments"
			name={name}
			file={file}
			actions={<KeepAction workspaceId={workspaceId} name={name} />}
		/>
	);
}
