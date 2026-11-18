import { Sidebar, SidebarContent, SidebarRail, useSidebar } from "@repo/ui";
import { anchorOf } from "@repo/ui-catalog";
import { useWorkspace } from "../lib/workspace.tsx";
import { EntryRail } from "./entry-rail.tsx";
import { WorkspaceTree } from "./workspace-tree.tsx";

export function RightSidebar() {
	const { workspace } = useWorkspace();
	const { state } = useSidebar();
	return (
		<Sidebar side="right" collapsible="icon" className="border-sidebar">
			<SidebarContent className="pt-3.5">
				{state === "expanded" ? (
					<div className="min-h-0 flex-1 overflow-y-auto px-1.5 text-[11.5px]">
						{workspace && (
							<WorkspaceTree workspaceId={workspace._id} side="right" />
						)}
					</div>
				) : (
					<EntryRail side="right" />
				)}
			</SidebarContent>
			<SidebarRail
				{...anchorOf("right/toggle")}
				className="hover:after:bg-transparent"
			/>
		</Sidebar>
	);
}
