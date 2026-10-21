import { convexQuery } from "@convex-dev/react-query";
import { Logout01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import { SortableTree } from "@repo/components";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenuButton,
	SidebarRail,
	useSidebar,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useNewChat } from "../lib/chats.ts";
import { dragsAs, type PanelContent } from "../lib/panel-ops.ts";
import { requestPanel } from "../lib/panel-requests.ts";
import { useSidebarMotion, useSidebarOrder } from "../lib/sidebar.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { WorkspaceMenu } from "./workspace-menu.tsx";
import { ENTRY_ICONS, WorkspaceTree } from "./workspace-tree.tsx";

function EntryRail() {
	const { shown, reorder } = useSidebarOrder();
	const { motion } = useSidebarMotion();
	const { setOpen } = useSidebar();
	const newChat = useNewChat();
	return (
		<div className="flex w-full flex-col items-center py-1">
			<SortableTree order={shown} onReorder={reorder} motion={motion}>
				{(entry) => (
					<div className="py-px">
						<SidebarMenuButton
							tooltip={entry}
							className="group-data-[collapsible=icon]:size-6! group-data-[collapsible=icon]:p-1!"
							onClick={() =>
								entry === "new_chat" ? void newChat() : setOpen(true)
							}
						>
							<HugeiconsIcon icon={ENTRY_ICONS[entry]} />
							<span>{entry}</span>
						</SidebarMenuButton>
					</div>
				)}
			</SortableTree>
		</div>
	);
}

const ACCOUNT: PanelContent = {
	kind: "page",
	page: "account",
	title: "account",
};

function UserRow({
	expanded,
	onSignOut,
}: {
	expanded: boolean;
	onSignOut: () => void;
}) {
	const { data: user } = useQuery(convexQuery(api.users.me, {}));
	const { workspace } = useWorkspace();
	const [armed, setArmed] = useState(false);
	return (
		<SidebarFooter
			className={
				expanded
					? "flex-row items-center gap-2 px-2.5 pb-3.5 text-[11px] text-dim"
					: "items-center gap-2 pb-3.5 text-dim"
			}
		>
			{expanded && (
				<span
					className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
					title={user?.email}
				>
					{user === undefined ? "" : user.name === "" ? user.email : user.name}
				</span>
			)}
			{workspace && (
				<Link
					to="/$workspaceId/account"
					params={{ workspaceId: workspace._id }}
					className={`${expanded ? "ml-auto" : ""} flex-none text-dim hover:text-fg`}
					activeProps={{ className: "text-fg" }}
					title="settings"
					aria-label="settings"
					onClick={(event) => {
						if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
						event.preventDefault();
						requestPanel(ACCOUNT);
					}}
					onDragStart={dragsAs(ACCOUNT)}
				>
					<HugeiconsIcon className="size-icon-sm" icon={Settings01Icon} />
				</Link>
			)}
			<button
				type="button"
				onClick={() => {
					if (!armed) {
						setArmed(true);
						return;
					}
					onSignOut();
				}}
				onBlur={() => setArmed(false)}
				onMouseLeave={() => setArmed(false)}
				title={armed ? "click again to sign out" : "sign out"}
				aria-label={armed ? "confirm sign out" : "sign out"}
				className={`flex flex-none cursor-pointer items-center gap-1 ${armed ? "text-red" : "text-dim hover:text-fg"}`}
			>
				{armed && expanded && (
					<span className="whitespace-nowrap">sign out?</span>
				)}
				<HugeiconsIcon className="size-icon-sm" icon={Logout01Icon} />
			</button>
		</SidebarFooter>
	);
}

export function LeftSidebar({ onSignOut }: { onSignOut: () => void }) {
	const { workspace } = useWorkspace();
	const { state } = useSidebar();
	const expanded = state === "expanded";

	return (
		<Sidebar side="left" collapsible="icon">
			{expanded && (
				<SidebarHeader className="pt-3.5">
					<WorkspaceMenu />
				</SidebarHeader>
			)}
			<SidebarContent>
				{expanded ? (
					<div className="min-h-0 flex-1 overflow-y-auto px-1.5 text-[11.5px]">
						{workspace && <WorkspaceTree workspaceId={workspace._id} />}
					</div>
				) : (
					<EntryRail />
				)}
			</SidebarContent>
			<UserRow expanded={expanded} onSignOut={onSignOut} />
			<SidebarRail className="hover:after:bg-transparent" />
		</Sidebar>
	);
}
