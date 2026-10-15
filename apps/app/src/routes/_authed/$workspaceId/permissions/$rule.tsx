import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FileView } from "../../../../components/file-view.tsx";
import { permissionRules } from "../../../../lib/files.ts";

export const Route = createFileRoute("/_authed/$workspaceId/permissions/$rule")(
	{
		params: {
			parse: ({ rule }: { rule: string }) => ({ rule: Number(rule) }),
			stringify: ({ rule }: { rule: number }) => ({ rule: String(rule) }),
		},
		component: PermissionFile,
	},
);

function PermissionFile() {
	const { workspaceId, rule } = Route.useParams();
	const { data: source } = useQuery(
		convexQuery(api.permissions.get, { workspaceId }),
	);
	const found =
		source === undefined ? undefined : permissionRules(source ?? "")[rule];

	return (
		<FileView
			file={
				found && { path: `permissions/${found.name}`, source: found.source }
			}
			missing={source === undefined ? undefined : "no such rule"}
		/>
	);
}
