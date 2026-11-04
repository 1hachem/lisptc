import { HugeiconsIcon } from "@hugeicons/react";
import { SortableSide } from "@repo/components";
import { SidebarMenuButton, useSidebar } from "@repo/ui";
import { useNewChat } from "../lib/chats.ts";
import { NEW_CHAT, type PanelContent } from "../lib/panel-ops.ts";
import { requestPanel } from "../lib/panel-requests.ts";
import type { SidebarEntry, SidebarSide } from "../lib/sidebar-order.ts";
import { ENTRY_ICONS, openFolderOnMount } from "./workspace-tree.tsx";

export const TREE_ROW = "flex h-[calc(1lh+0.5rem)] items-center text-[11.5px]";

const PAGES: Partial<Record<SidebarEntry, PanelContent>> = {
	home: NEW_CHAT,
	"README.md": { kind: "page", page: "readme", title: "README.md" },
	settings: { kind: "page", page: "settings", title: "settings" },
	preferences: {
		kind: "page",
		page: "preferences",
		title: "preferences",
	},
};

function useRailPick() {
	const { setOpen } = useSidebar();
	const newChat = useNewChat();
	return (entry: SidebarEntry) => {
		if (entry === "new_chat") return newChat();
		const page = PAGES[entry];
		if (page !== undefined) return requestPanel(page);
		openFolderOnMount(entry);
		setOpen(true);
	};
}

export function EntryRail({ side }: { side: SidebarSide }) {
	const pick = useRailPick();
	return (
		<SortableSide<SidebarEntry>
			side={side}
			className="flex min-h-24 w-full flex-col items-center"
		>
			{(entry) => (
				<div className={TREE_ROW}>
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
		</SortableSide>
	);
}

export function EntryDragged({ entry }: { entry: SidebarEntry }) {
	return (
		<div className={`${TREE_ROW} gap-2 px-2`}>
			<HugeiconsIcon className="size-icon-sm" icon={ENTRY_ICONS[entry]} />
			<span>{entry}</span>
		</div>
	);
}
