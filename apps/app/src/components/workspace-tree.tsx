import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import {
	Book02Icon,
	BubbleChatIcon,
	FlashIcon,
	Home01Icon,
	InformationCircleIcon,
	PaintBoardIcon,
	ShieldKeyIcon,
	StickyNote01Icon,
	TaskDone01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import type { Doc, Id } from "@repo/backend/dataModel";
import {
	FileTree,
	SortableTree,
	TreeCommand,
	TreeFile,
	TreeFilter,
	TreeFolder,
	TreeMore,
} from "@repo/components";
import { useQuery } from "@tanstack/react-query";
import {
	Link,
	useLocation,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { restingIcon } from "../lib/bot-icon.ts";
import { useNewChat } from "../lib/chats.ts";
import { permissionRules, withoutRule } from "../lib/files.ts";
import { readBoolPref, writeBoolPref } from "../lib/prefs.ts";
import { useSidebarMotion, useSidebarOrder } from "../lib/sidebar.ts";
import type { SidebarEntry } from "../lib/sidebar-order.ts";
import { FileMenu } from "./file-menu.tsx";
import { SessionRow } from "./session-row.tsx";

const PLACEHOLDERS = [
	"knowledge",
	"sub-agents",
	"triggers",
	"tasks",
	"ui",
] as const;

type Folder =
	| "chat"
	| "memories"
	| "permissions"
	| (typeof PLACEHOLDERS)[number];

const FOLDER_ICONS: Record<Folder, IconSvgElement> = {
	chat: BubbleChatIcon,
	memories: StickyNote01Icon,
	permissions: ShieldKeyIcon,
	knowledge: Book02Icon,
	"sub-agents": restingIcon(),
	triggers: FlashIcon,
	tasks: TaskDone01Icon,
	ui: PaintBoardIcon,
};

function useLeave(workspaceId: Id<"workspaces">) {
	const navigate = useNavigate();
	return (selected: boolean) =>
		selected
			? navigate({
					to: "/$workspaceId",
					params: { workspaceId },
					replace: true,
				})
			: Promise.resolve();
}

function Empty({ children }: { children: ReactNode }) {
	return <div className="py-1 pl-9 text-dim">{children}</div>;
}

function Listing<T>({
	items,
	empty,
	children,
}: {
	items: T[] | undefined;
	empty: string;
	children: (item: T) => ReactNode;
}) {
	if (items === undefined) return null;
	if (items.length === 0) return <Empty>{empty}</Empty>;
	return items.map(children);
}

const FOLDERS = [
	"chat",
	"memories",
	"permissions",
	...PLACEHOLDERS,
] as const satisfies readonly Folder[];

function isFolder(entry: SidebarEntry): entry is Folder {
	return FOLDERS.some((folder) => folder === entry);
}

function folderCookie(folder: Folder) {
	return `ui.folder.${folder}`;
}

function useFolders() {
	const [opened, setOpened] = useState(
		() =>
			Object.fromEntries(
				FOLDERS.map((folder) => [
					folder,
					readBoolPref(folderCookie(folder), folder === "chat"),
				]),
			) as Record<Folder, boolean>,
	);
	return (folder: Folder) => ({
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

const CHAT_PAGE = 20;
const SEARCH_DELAY_MS = 200;

function useSettled(value: string) {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(value), SEARCH_DELAY_MS);
		return () => clearTimeout(timer);
	}, [value]);
	return settled;
}

function ChatFolder({
	workspaceId,
	current,
	folder,
}: {
	workspaceId: Id<"workspaces">;
	current: string | undefined;
	folder: { open: boolean; onToggle: () => void };
}) {
	const newChat = useNewChat();
	const [search, setSearch] = useState("");
	const settled = useSettled(search);
	const [limit, setLimit] = useState(CHAT_PAGE);
	const { data: page } = useQuery({
		...convexQuery(api.chats.list, { workspaceId, search: settled, limit }),
		placeholderData: (previous) => previous,
		enabled: folder.open,
	});

	return (
		<TreeFolder
			name="chat"
			icon={FOLDER_ICONS.chat}
			{...folder}
			onCreate={() => void newChat()}
			createLabel="new chat"
		>
			<TreeFilter
				value={search}
				onChange={(next) => {
					setSearch(next);
					setLimit(CHAT_PAGE);
				}}
				label="search chats"
			/>
			<Listing
				items={page?.chats}
				empty={settled ? `nothing matches ${settled}` : "no chats yet"}
			>
				{(chat) => (
					<SessionRow
						key={chat._id}
						chat={chat}
						current={chat._id === current}
					/>
				)}
			</Listing>
			{page?.more && (
				<TreeMore onMore={() => setLimit((shown) => shown + CHAT_PAGE)} />
			)}
		</TreeFolder>
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
	const { data: memories } = useQuery(
		convexQuery(api.memories.list, { workspaceId }),
	);

	const { order, reorder } = useSidebarOrder();
	const { motion } = useSidebarMotion();

	const placeholder = (name: (typeof PLACEHOLDERS)[number]) => () => (
		<TreeFolder
			name={name}
			icon={FOLDER_ICONS[name]}
			{...folder(name)}
			onCreate="disabled"
			createLabel="coming soon"
		>
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
			<TreeFolder
				name="memories"
				icon={FOLDER_ICONS.memories}
				{...folder("memories")}
			>
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
			<TreeFolder
				name="permissions"
				icon={FOLDER_ICONS.permissions}
				{...folder("permissions")}
			>
				<PermissionFiles workspaceId={workspaceId} selected={params.rule} />
			</TreeFolder>
		),
		knowledge: placeholder("knowledge"),
		"sub-agents": placeholder("sub-agents"),
		triggers: placeholder("triggers"),
		tasks: placeholder("tasks"),
		ui: placeholder("ui"),
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
				order={order}
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
