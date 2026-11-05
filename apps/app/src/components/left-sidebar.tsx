import { convexQuery } from "@convex-dev/react-query";
import { Logout01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarRail,
	useSidebar,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { dragsAs, type PanelContent } from "../lib/panel-ops.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { EntryRail, TREE_ROW } from "./entry-rail.tsx";
import { PanelLink } from "./panel-link.tsx";
import { WorkspaceMenu, WorkspaceRailMenu } from "./workspace-menu.tsx";
import { WorkspaceTree } from "./workspace-tree.tsx";

const ACCOUNT: PanelContent = {
	kind: "page",
	page: "account",
	title: "account",
};

function UserName() {
	const { data: user } = useQuery(convexQuery(api.users.me, {}));
	const name = user === undefined ? "" : user.name || user.email;
	return (
		<span
			className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
			title={user?.email}
		>
			{name}
		</span>
	);
}

function SettingsLink({ expanded }: { expanded: boolean }) {
	const { workspace } = useWorkspace();
	if (!workspace) return null;
	return (
		<PanelLink
			workspaceId={workspace._id}
			content={ACCOUNT}
			className={`${expanded ? "ml-auto" : ""} flex-none text-dim hover:text-fg`}
			title="settings"
			label="settings"
			onDragStart={dragsAs(ACCOUNT)}
		>
			<HugeiconsIcon className="size-icon-sm" icon={Settings01Icon} />
		</PanelLink>
	);
}

function SignOutButton({
	expanded,
	onSignOut,
}: {
	expanded: boolean;
	onSignOut: () => void;
}) {
	const [armed, setArmed] = useState(false);
	return (
		<button
			type="button"
			onClick={() => (armed ? onSignOut() : setArmed(true))}
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
	);
}

function UserRow({
	expanded,
	onSignOut,
}: {
	expanded: boolean;
	onSignOut: () => void;
}) {
	return (
		<SidebarFooter
			className={
				expanded
					? "flex-row items-center gap-2 px-3.5 pb-3.5 text-[11px] text-dim"
					: "items-center gap-2 pb-3.5 text-dim"
			}
		>
			{expanded && <UserName />}
			<SettingsLink expanded={expanded} />
			<SignOutButton expanded={expanded} onSignOut={onSignOut} />
		</SidebarFooter>
	);
}

export function LeftSidebar({ onSignOut }: { onSignOut: () => void }) {
	const { workspace } = useWorkspace();
	const { state, setOpen } = useSidebar();
	const expanded = state === "expanded";
	const [creating, setCreating] = useState(false);
	if (!expanded && creating) setCreating(false);

	return (
		<Sidebar side="left" collapsible="icon" className="border-sidebar">
			<SidebarHeader className={expanded ? "pt-3.5" : "items-center pt-3.5"}>
				{expanded ? (
					<WorkspaceMenu startCreating={creating} />
				) : (
					<div className={TREE_ROW}>
						<WorkspaceRailMenu
							onCreate={() => {
								setCreating(true);
								setOpen(true);
							}}
						/>
					</div>
				)}
			</SidebarHeader>
			<SidebarContent>
				{expanded ? (
					<div className="min-h-0 flex-1 overflow-y-auto px-1.5 text-[11.5px]">
						{workspace && (
							<WorkspaceTree workspaceId={workspace._id} side="left" />
						)}
					</div>
				) : (
					<EntryRail side="left" />
				)}
			</SidebarContent>
			<UserRow expanded={expanded} onSignOut={onSignOut} />
			<SidebarRail className="hover:after:bg-transparent" />
		</Sidebar>
	);
}
