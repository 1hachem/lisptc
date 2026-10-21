import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { DEFAULT_CHOICE } from "@repo/shared/providers";
import { useQuery } from "@tanstack/react-query";
import { settingsSource } from "../lib/files.ts";
import { useModelPicker } from "../lib/model-picker.tsx";
import { FileView } from "./file-view.tsx";

export function SettingsPage({
	workspaceId,
}: {
	workspaceId: Id<"workspaces">;
}) {
	const { data: workspace, error } = useQuery(
		convexQuery(api.workspaces.get, { workspaceId }),
	);
	if (error) throw error;
	const { openModelPicker } = useModelPicker();

	return (
		<FileView
			file={
				workspace
					? {
							path: "settings.ptc",
							source: settingsSource(
								workspace,
								workspace.model ?? DEFAULT_CHOICE,
							),
						}
					: undefined
			}
			actions={
				<button
					type="button"
					onClick={openModelPicker}
					className="flex-none cursor-pointer hover:text-fg"
				>
					change model
				</button>
			}
		/>
	);
}
