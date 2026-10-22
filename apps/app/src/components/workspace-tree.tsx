import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import {
	Attachment01Icon,
	Book02Icon,
	BubbleChatIcon,
	Delete02Icon,
	FlashIcon,
	Home01Icon,
	InformationCircleIcon,
	PaintBoardIcon,
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
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { restingIcon } from "../lib/bot-icon.ts";
import { useNewChat } from "../lib/chats.ts";
import { permissionRules, withoutRule } from "../lib/files.ts";
import { readBoolPref, writeBoolPref } from "../lib/prefs.ts";
import { useSidebarMotion, useSidebarOrder } from "../lib/sidebar.ts";
import {
	SIDEBAR_FOLDERS,
	type SidebarEntry,
	type SidebarFolder,
} from "../lib/sidebar-order.ts";
import { ChatFolder } from "./chat-folder.tsx";
import {
	AttachmentsFolder,
	BinFolder,
	KnowledgeFolder,
} from "./file-folder.tsx";
import { FileMenu } from "./file-menu.tsx";
import { Empty, type FolderState, Listing, useLeave } from "./tree-listing.tsx";

const PLACEHOLDERS = [
	"sub-agents",
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

function isFolder(entry: SidebarEntry): entry is SidebarFolder {
	return SIDEBAR_FOLDERS.some((folder) => folder === entry);
}

function folderCookie(folder: SidebarFolder) {
	return `ui.folder.${folder}`;
}

function useFolders() {
	const [opened, setOpened] = useState(
		() =>
			Object.fromEntries(
				SIDEBAR_FOLDERS.map((folder) => [
					folder,
					readBoolPref(folderCookie(folder), folder === "chat"),
				]),
			) as Record<SidebarFolder, boolean>,
	);
	return <F extends SidebarFolder>(folder: F): FolderState<F> => ({
		name: folder,
		icon: FOLDER_ICONS[folder],
		open: opened[folder],
		onToggle: () => {
			const next = !opened[folder];
			writeBoolPref(folderCookie(folder), next);
			setOpened((prev) => ({ ...prev, [folder]: next }));
		},
	});
}

function MemoryFile({
	memory,
	selected,
}: {
	memory: Doc<"memories">;
	selected: boolean;
}) {
	const removeMemory = useConvexMutation(api.memories.remove);
	const leave = useLeave(memory.workspaceId);

	return (
		<TreeFile
			name={memory.key}
			depth={1}
			selected={selected}
			trailing={
				<FileMenu
					name={memory.key}
					confirm="forget it for good?"
					onDelete={async () => {
						await leave(selected);
						await removeMemory({
							workspaceId: memory.workspaceId,
							key: memory.key,
						});
					}}
				/>
			}
			link={(content, className) => (
				<Link
					to="/$workspaceId/memories/$key"
					params={{ workspaceId: memory.workspaceId, key: memory.key }}
					className={className}
				>
					{content}
				</Link>
			)}
		/>
	);
}

function PermissionFiles({
	workspaceId,
	selected,
}: {
	workspaceId: Id<"workspaces">;
	selected: number | undefined;
}) {
	const { data: source } = useQuery(
		convexQuery(api.permissions.get, { workspaceId }),
	);
	const putPermissions = useConvexMutation(api.permissions.put);
	const leave = useLeave(workspaceId);
	const rules =
		source === undefined ? undefined : permissionRules(source ?? "");

	return (
		<Listing items={rules} empty="no rules yet">
			{(rule) => {
				const index = rules?.indexOf(rule) ?? -1;
				return (
					<TreeFile
						key={rule.start}
						name={rule.name}
						depth={1}
						selected={selected === index}
						trailing={
							<FileMenu
								name={rule.name}
								confirm="drop this rule?"
								onDelete={async () => {
									await leave(selected === index);
									await putPermissions({
										workspaceId,
										source: withoutRule(source ?? "", rule),
									});
								}}
							/>
						}
						link={(content, className) => (
							<Link
								to="/$workspaceId/permissions/$rule"
								params={{ workspaceId, rule: index }}
								className={className}
							>
								{content}
							</Link>
						)}
					/>
				);
			}}
		</Listing>
	);
}

function HomeFile({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
	const selected = useLocation({
		select: (location) =>
			location.pathname.replace(/\/$/, "") === `/${workspaceId}`,
	});
	return (
		<TreeFile
			name="home"
			icon={Home01Icon}
			selected={selected}
			link={(content, className) => (
				<Link to="/$workspaceId" params={{ workspaceId }} className={className}>
					{content}
				</Link>
			)}
		/>
	);
}

const ROOT_FILES: Record<
	"readme" | "settings" | "preferences",
	{ name: string; icon?: IconSvgElement }
> = {
	readme: { name: "README.md", icon: InformationCircleIcon },
	settings: { name: "settings.ptc" },
	preferences: { name: "preferences.ptc" },
};

function RootFile({
	workspaceId,
	page,
}: {
	workspaceId: Id<"workspaces">;
	page: keyof typeof ROOT_FILES;
}) {
	const selected = useLocation({
		select: (location) => location.pathname.endsWith(`/${page}`),
	});
	return (
		<TreeFile
			name={ROOT_FILES[page].name}
			icon={ROOT_FILES[page].icon}
			selected={selected}
			link={(content, className) => (
				<Link
					to={`/$workspaceId/${page}`}
					params={{ workspaceId }}
					className={className}
				>
					{content}
				</Link>
			)}
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
	const params = useParams({ strict: false });
	const fileFolder = useLocation({
		select: (location) => location.pathname.split("/")[2],
	});
	const { data: memories } = useQuery(
		convexQuery(api.memories.list, { workspaceId }),
	);

	const { shown, reorder } = useSidebarOrder();
	const { motion } = useSidebarMotion();

	const placeholder = (name: (typeof PLACEHOLDERS)[number]) => () => (
		<TreeFolder {...folder(name)} onCreate="disabled" createLabel="coming soon">
			<Empty>no {name} yet</Empty>
		</TreeFolder>
	);

	const entries: Record<SidebarEntry, () => ReactNode> = {
		home: () => <HomeFile workspaceId={workspaceId} />,
		new_chat: () => (
			<TreeCommand name="new_chat" onRun={() => void newChat()} />
		),
		chat: () => (
			<ChatFolder
				workspaceId={workspaceId}
				current={params.chatId}
				folder={folder("chat")}
			/>
		),
		memories: () => (
			<TreeFolder {...folder("memories")}>
				<Listing items={memories} empty="no memories yet">
					{(memory) => (
						<MemoryFile
							key={memory._id}
							memory={memory}
							selected={params.key === memory.key}
						/>
					)}
				</Listing>
			</TreeFolder>
		),
		permissions: () => (
			<TreeFolder {...folder("permissions")}>
				<PermissionFiles workspaceId={workspaceId} selected={params.rule} />
			</TreeFolder>
		),
		knowledge: () => (
			<KnowledgeFolder
				workspaceId={workspaceId}
				current={fileFolder === "knowledge" ? params.name : undefined}
				folder={folder("knowledge")}
			/>
		),
		attachments: () => (
			<AttachmentsFolder
				workspaceId={workspaceId}
				current={fileFolder === "attachments" ? params.name : undefined}
				folder={folder("attachments")}
			/>
		),
		bin: () => (
			<BinFolder
				workspaceId={workspaceId}
				current={fileFolder === "bin" ? params.name : undefined}
				folder={folder("bin")}
			/>
		),
		"sub-agents": placeholder("sub-agents"),
		triggers: placeholder("triggers"),
		tasks: placeholder("tasks"),
		ui: placeholder("ui"),
		tests: placeholder("tests"),
		"README.md": () => <RootFile workspaceId={workspaceId} page="readme" />,
		"settings.ptc": () => (
			<RootFile workspaceId={workspaceId} page="settings" />
		),
		"preferences.ptc": () => (
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
