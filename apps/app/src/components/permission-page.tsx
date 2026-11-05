import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { permissionRules } from "../lib/files.ts";
import { PageView } from "./file-view.tsx";
import { Field, RuleCard } from "./read-only.tsx";

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
		<PageView title={found ? `permissions/${found.name}` : "permissions"}>
			{found === undefined ? (
				<div className="text-dim">
					{source === undefined ? "loading…" : "no such rule"}
				</div>
			) : (
				<Field label="rule">
					<RuleCard source={found.source} />
				</Field>
			)}
		</PageView>
	);
}
