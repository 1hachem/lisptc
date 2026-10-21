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
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useNewChat } from "../lib/chats.ts";
import { dragsAs, type PanelContent } from "../lib/panel-ops.ts";
import { requestPanel } from "../lib/panel-requests.ts";
import { useSidebarMotion, useSidebarOrder } from "../lib/sidebar.ts";
import type { SidebarEntry } from "../lib/sidebar-order.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { WorkspaceMenu, WorkspaceRailMenu } from "./workspace-menu.tsx";
import {
	ENTRY_ICONS,
	openFolderOnMount,
	WorkspaceTree,
} from "./workspace-tree.tsx";

const PAGES: Partial<
	Record<SidebarEntry, "readme" | "settings" | "preferences">
> = {
	"README.md": "readme",
	"settings.ptc": "settings",
	"preferences.ptc": "preferences",
};

function useRailPick() {
	const { setOpen } = useSidebar();
	const newChat = useNewChat();
	const navigate = useNavigate();
	const { workspace } = useWorkspace();
	return (entry: SidebarEntry) => {
		if (entry === "new_chat") return void newChat();
		const page = PAGES[entry];
		if (workspace && entry === "home")
			return void navigate({
				to: "/$workspaceId",
				params: { workspaceId: workspace._id },
			});
		if (workspace && page !== undefined)
			return void navigate({
				to: `/$workspaceId/${page}`,
				params: { workspaceId: workspace._id },
			});
		openFolderOnMount(entry);
		setOpen(true);
	};
}

function EntryRail() {
	const { shown, reorder } = useSidebarOrder();
	const { motion } = useSidebarMotion();
	const pick = useRailPick();
	return (
		<div className="flex w-full flex-col items-center py-1">
			<SortableTree order={shown} onReorder={reorder} motion={motion}>
				{(entry) => (
					<div className="py-px">
						<SidebarMenuButton
							tooltip={entry}
							className="group-data-[collapsible=icon]:size-6! group-data-[collapsible=icon]:p-1!"
							onClick={() => pick(entry)}
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

function opensInPlace(event: {
	button: number;
	metaKey: boolean;
	ctrlKey: boolean;
}): boolean {
	return event.button === 0 && !event.metaKey && !event.ctrlKey;
}

function SettingsLink({ expanded }: { expanded: boolean }) {
	const { workspace } = useWorkspace();
	if (!workspace) return null;
	return (
		<Link
			to="/$workspaceId/account"
			params={{ workspaceId: workspace._id }}
			className={`${expanded ? "ml-auto" : ""} flex-none text-dim hover:text-fg`}
			activeProps={{ className: "text-fg" }}
			title="settings"
			aria-label="settings"
			onClick={(event) => {
				if (!opensInPlace(event)) return;
				event.preventDefault();
				requestPanel(ACCOUNT);
			}}
			onDragStart={dragsAs(ACCOUNT)}
		>
			<HugeiconsIcon className="size-icon-sm" icon={Settings01Icon} />
		</Link>
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
					? "flex-row items-center gap-2 px-2.5 pb-3.5 text-[11px] text-dim"
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
					<WorkspaceRailMenu
						onCreate={() => {
							setCreating(true);
							setOpen(true);
						}}
					/>
				)}
			</SidebarHeader>
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
