import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { permissionRules } from "../lib/files.ts";
import { FileView } from "./file-view.tsx";

export function PermissionPage({
	workspaceId,
	rule,
}: {
	workspaceId: Id<"workspaces">;
	rule: number;
}) {
	const { data: source, error } = useQuery(
		convexQuery(api.permissions.get, { workspaceId }),
	);
	if (error) throw error;
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
