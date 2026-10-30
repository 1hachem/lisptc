import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import {
	Add01Icon,
	Attachment01Icon,
	Book02Icon,
	BubbleChatIcon,
	Delete02Icon,
	File01Icon,
	FlashIcon,
	Home01Icon,
	InformationCircleIcon,
	PaintBoardIcon,
	Settings02Icon,
	ShieldKeyIcon,
	StickyNote01Icon,
	TaskDone01Icon,
	TestTube01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import type { Doc, Id } from "@repo/backend/dataModel";
import {
	FileTree,
	SortableTree,
	TreeCommand,
	TreeFile,
	TreeFolder,
} from "@repo/components";
import {
	type AnchorMark,
	anchorOf,
	SIDEBAR_FOLDERS,
	type SidebarFolder,
} from "@repo/ui-catalog";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { restingIcon } from "../lib/bot-icon.ts";
import { useNewChat } from "../lib/chats.ts";
import { permissionRules, withoutRule } from "../lib/files.ts";
import { dragsAs, NEW_CHAT, type PanelContent } from "../lib/panel-ops.ts";
import { requestPanelClosed } from "../lib/panel-requests.ts";
import { writeBoolPref } from "../lib/prefs.ts";
import { useSidebarMotion, useSidebarOrder } from "../lib/sidebar.ts";
import type { SidebarEntry } from "../lib/sidebar-order.ts";
import { folderCookie, folderOpen } from "../lib/sidebar-prefetch.ts";
import { ChatFolder } from "./chat-folder.tsx";
import {
	AttachmentsFolder,
	BinFolder,
	KnowledgeFolder,
} from "./file-folder.tsx";
import { FileMenu } from "./file-menu.tsx";
import { linkTo, useShown } from "./panel-link.tsx";
import { SourceFolder } from "./source-folder.tsx";
import { Empty, type FolderState, Listing } from "./tree-listing.tsx";

const PLACEHOLDERS = [
	"triggers",
	"tasks",
	"ui",
	"tests",
] as const satisfies readonly SidebarFolder[];

const FOLDER_ICONS: Record<SidebarFolder, IconSvgElement> = {
	chat: BubbleChatIcon,
	memories: StickyNote01Icon,
	permissions: ShieldKeyIcon,
	knowledge: Book02Icon,
	attachments: Attachment01Icon,
	bin: Delete02Icon,
	"sub-agents": restingIcon(),
	triggers: FlashIcon,
	tasks: TaskDone01Icon,
	ui: PaintBoardIcon,
	tests: TestTube01Icon,
};

const FOLDER_ANCHORS: Record<SidebarFolder, AnchorMark> = {
	chat: anchorOf("chats"),
	memories: anchorOf("memories"),
	permissions: anchorOf("permissions"),
	knowledge: anchorOf("knowledge"),
	attachments: anchorOf("attachments"),
	bin: anchorOf("bin"),
	"sub-agents": anchorOf("sub-agents"),
	triggers: anchorOf("triggers"),
	tasks: anchorOf("tasks"),
	ui: anchorOf("ui"),
	tests: anchorOf("tests"),
};

export const ENTRY_ANCHORS: Record<SidebarEntry, AnchorMark> = {
	...FOLDER_ANCHORS,
	home: anchorOf("home"),
	new_chat: anchorOf("new-chat"),
	"README.md": anchorOf("readme"),
	settings: anchorOf("settings"),
	preferences: anchorOf("preferences"),
};

export const ENTRY_ICONS: Record<SidebarEntry, IconSvgElement> = {
	...FOLDER_ICONS,
	home: Home01Icon,
	new_chat: Add01Icon,
	"README.md": InformationCircleIcon,
	settings: Settings02Icon,
	preferences: File01Icon,
};

function memoryPage(key: string): PanelContent {
	return { kind: "page", page: "memory", id: key, title: `memories/${key}` };
}

function permissionPage(index: number, name: string): PanelContent {
	return {
		kind: "page",
		page: "permission",
		id: String(index),
		title: `permissions/${name}`,
	};
}

function isFolder(entry: SidebarEntry): entry is SidebarFolder {
	return SIDEBAR_FOLDERS.some((folder) => folder === entry);
}

const folderOpeners = new Set<(folder: SidebarFolder) => void>();

export function openFolder(entry: SidebarEntry) {
	if (!isFolder(entry)) return;
	writeBoolPref(folderCookie(entry), true);
	for (const open of folderOpeners) open(entry);
}

function useFolders() {
	const [opened, setOpened] = useState(
		() =>
			Object.fromEntries(
				SIDEBAR_FOLDERS.map((folder) => [folder, folderOpen(folder)]),
			) as Record<SidebarFolder, boolean>,
	);
	useEffect(() => {
		const open = (folder: SidebarFolder) =>
			setOpened((prev) => (prev[folder] ? prev : { ...prev, [folder]: true }));
		folderOpeners.add(open);
		return () => {
			folderOpeners.delete(open);
		};
	}, []);
	return <F extends SidebarFolder>(folder: F): FolderState<F> => ({
		name: folder,
		icon: FOLDER_ICONS[folder],
		toggleAnchor: FOLDER_ANCHORS[folder],
		open: opened[folder],
		onToggle: () => {
			const next = !opened[folder];
			writeBoolPref(folderCookie(folder), next);
			setOpened((prev) => ({ ...prev, [folder]: next }));
		},
	});
}

function MemoryFile({ memory }: { memory: Doc<"memories"> }) {
	const removeMemory = useConvexMutation(api.memories.remove);
	const shown = useShown();
	const page = memoryPage(memory.key);

	return (
		<TreeFile
			anchor={FOLDER_ANCHORS.memories}
			name={memory.key}
			depth={1}
			selected={shown(page)}
			onDragStart={dragsAs(page)}
			trailing={
				<FileMenu
					name={memory.key}
					confirm="forget it for good?"
					onDelete={async () => {
						requestPanelClosed(page);
						await removeMemory({
							workspaceId: memory.workspaceId,
							key: memory.key,
						});
					}}
				/>
			}
			link={linkTo(memory.workspaceId, page)}
		/>
	);
}

function PermissionFiles({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
	const { data: source } = useQuery(
		convexQuery(api.permissions.get, { workspaceId }),
	);
	const putPermissions = useConvexMutation(api.permissions.put);
	const shown = useShown();
	const rules =
		source === undefined ? undefined : permissionRules(source ?? "");

	return (
		<Listing items={rules} empty="no rules yet">
			{(rule) => {
				const index = rules?.indexOf(rule) ?? -1;
				const page = permissionPage(index, rule.name);
				return (
					<TreeFile
						anchor={FOLDER_ANCHORS.permissions}
						key={rule.start}
						name={rule.name}
						depth={1}
						selected={shown(page)}
						onDragStart={dragsAs(page)}
						trailing={
							<FileMenu
								name={rule.name}
								confirm="drop this rule?"
								onDelete={async () => {
									requestPanelClosed(page);
									await putPermissions({
										workspaceId,
										source: withoutRule(source ?? "", rule),
									});
								}}
							/>
						}
						link={linkTo(workspaceId, page)}
					/>
				);
			}}
		</Listing>
	);
}

function HomeFile({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
	return (
		<TreeFile
			anchor={ENTRY_ANCHORS.home}
			name="home"
			icon={Home01Icon}
			selected={false}
			onDragStart={dragsAs(NEW_CHAT)}
			link={linkTo(workspaceId, NEW_CHAT)}
		/>
	);
}

const ROOT_FILES: Record<
	"readme" | "settings" | "preferences",
	{ name: SidebarEntry; icon?: IconSvgElement }
> = {
	readme: { name: "README.md", icon: InformationCircleIcon },
	settings: { name: "settings" },
	preferences: { name: "preferences" },
};

function RootFile({
	workspaceId,
	page,
}: {
	workspaceId: Id<"workspaces">;
	page: keyof typeof ROOT_FILES;
}) {
	const shown = useShown();
	const content: PanelContent = {
		kind: "page",
		page,
		title: ROOT_FILES[page].name,
	};
	return (
		<TreeFile
			anchor={ENTRY_ANCHORS[ROOT_FILES[page].name]}
			name={ROOT_FILES[page].name}
			icon={ROOT_FILES[page].icon}
			selected={shown(content)}
			onDragStart={dragsAs(content)}
			link={linkTo(workspaceId, content)}
		/>
	);
}

export function WorkspaceTree({
	workspaceId,
}: {
	workspaceId: Id<"workspaces">;
}) {
	const newChat = useNewChat();
	const folder = useFolders();
	const { data: memories } = useQuery(
		convexQuery(api.memories.list, { workspaceId }),
	);

	const { shown, reorder } = useSidebarOrder();
	const { motion } = useSidebarMotion();

	const placeholder = (name: (typeof PLACEHOLDERS)[number]) => () => (
		<TreeFolder
			{...folder(name)}
			onCreate="disabled"
			createLabel="coming soon"
			createAnchor={FOLDER_ANCHORS[name]}
		>
			<Empty>no {name} yet</Empty>
		</TreeFolder>
	);

	const entries: Record<SidebarEntry, () => ReactNode> = {
		home: () => <HomeFile workspaceId={workspaceId} />,
		new_chat: () => (
			<TreeCommand
				anchor={ENTRY_ANCHORS.new_chat}
				name="new_chat"
				onRun={() => void newChat()}
			/>
		),
		chat: () => (
			<ChatFolder workspaceId={workspaceId} folder={folder("chat")} />
		),
		memories: () => (
			<TreeFolder {...folder("memories")}>
				<Listing items={memories} empty="no memories yet">
					{(memory) => <MemoryFile key={memory._id} memory={memory} />}
				</Listing>
			</TreeFolder>
		),
		permissions: () => (
			<TreeFolder {...folder("permissions")}>
				<PermissionFiles workspaceId={workspaceId} />
			</TreeFolder>
		),
		knowledge: () => (
			<KnowledgeFolder workspaceId={workspaceId} folder={folder("knowledge")} />
		),
		attachments: () => (
			<AttachmentsFolder
				workspaceId={workspaceId}
				folder={folder("attachments")}
			/>
		),
		bin: () => <BinFolder workspaceId={workspaceId} folder={folder("bin")} />,
		"sub-agents": () => (
			<SourceFolder
				workspaceId={workspaceId}
				folder={folder("sub-agents")}
				empty="no sub-agents yet"
			/>
		),
		triggers: placeholder("triggers"),
		tasks: placeholder("tasks"),
		ui: placeholder("ui"),
		tests: placeholder("tests"),
		"README.md": () => <RootFile workspaceId={workspaceId} page="readme" />,
		settings: () => <RootFile workspaceId={workspaceId} page="settings" />,
		preferences: () => (
			<RootFile workspaceId={workspaceId} page="preferences" />
		),
	};

	return (
		<FileTree>
			<SortableTree
				order={shown}
				onReorder={reorder}
				onPickUp={(name) => {
					if (isFolder(name) && folder(name).open) folder(name).onToggle();
				}}
				motion={motion}
			>
				{(name) => entries[name]()}
			</SortableTree>
		</FileTree>
	);
}
