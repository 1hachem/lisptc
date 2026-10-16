import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { DEFAULT_CHOICE } from "@repo/shared/providers";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FileView } from "../../../components/file-view.tsx";
import { settingsSource } from "../../../lib/files.ts";
import { useModelPicker } from "../../../lib/model-picker.tsx";

export const Route = createFileRoute("/_authed/$workspaceId/settings")({
	loader: async ({ context, params }) => {
		if (context.auth.source === "browser") return;
		await context.queryClient.ensureQueryData(
			convexQuery(api.workspaces.get, { workspaceId: params.workspaceId }),
		);
	},
	component: SettingsFile,
});

function SettingsFile() {
	const { workspaceId } = Route.useParams();
	const { data: workspace } = useQuery(
		convexQuery(api.workspaces.get, { workspaceId }),
	);
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
