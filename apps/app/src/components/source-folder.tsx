import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { TreeFile, TreeFolder } from "@repo/components";
import type { AnchorMark } from "@repo/ui-catalog";
import { useQuery } from "@tanstack/react-query";
import { dragsAs, sourcePanel } from "../lib/panel-ops.ts";
import { requestPanelClosed } from "../lib/panel-requests.ts";
import { FileMenu } from "./file-menu.tsx";
import { linkTo, useShown } from "./panel-link.tsx";
import { type FolderState, Listing } from "./tree-listing.tsx";

function SourceFile({
	workspaceId,
	folder,
	name,
	anchor,
}: {
	workspaceId: Id<"workspaces">;
	folder: string;
	name: string;
	anchor: AnchorMark;
}) {
	const remove = useConvexMutation(api.sources.remove);
	const shown = useShown();
	const panel = sourcePanel(folder, name);

	return (
		<TreeFile
			anchor={anchor}
			name={name}
			depth={1}
			selected={shown(panel)}
			onDragStart={dragsAs(panel)}
			trailing={
				<FileMenu
					name={name}
					confirm="delete it for good?"
					onDelete={async () => {
						requestPanelClosed(panel);
						await remove({ workspaceId, folder, name });
					}}
				/>
			}
			link={linkTo(workspaceId, panel)}
		/>
	);
}

export function SourceFolder({
	workspaceId,
	folder,
	empty,
}: {
	workspaceId: Id<"workspaces">;
	folder: FolderState;
	empty: string;
}) {
	const { data: names } = useQuery(
		convexQuery(api.sources.list, { workspaceId, folder: folder.name }),
	);

	return (
		<TreeFolder {...folder}>
			<Listing items={names} empty={empty}>
				{(name) => (
					<SourceFile
						key={name}
						workspaceId={workspaceId}
						folder={folder.name}
						name={name}
						anchor={folder.toggleAnchor}
					/>
				)}
			</Listing>
		</TreeFolder>
	);
}
