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
	TreeAction,
	type TreeCheck,
	TreeCommand,
	TreeFile,
	TreeFilter,
	TreeFolder,
	TreeGroup,
	TreeMore,
	TreePending,
	TreeSelection,
} from "@repo/components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Link,
	useLocation,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { useAttempt } from "../lib/attempt.ts";
import { restoreFailure } from "../lib/bin.ts";
import { restingIcon } from "../lib/bot-icon.ts";
import { useNewChat } from "../lib/chats.ts";
import { byDate } from "../lib/date-groups.ts";
import { eachOf, saveAs, searched, useSelection } from "../lib/file-list.ts";
import { permissionRules, withoutRule } from "../lib/files.ts";
import { knowledgeIcon, useKnowledgeUpload } from "../lib/knowledge.ts";
import { readBoolPref, writeBoolPref } from "../lib/prefs.ts";
import { useSidebarMotion, useSidebarOrder } from "../lib/sidebar.ts";
import type { SidebarEntry } from "../lib/sidebar-order.ts";
import { FileMenu } from "./file-menu.tsx";
import { SessionRow } from "./session-row.tsx";

const PLACEHOLDERS = [
	"sub-agents",
	"triggers",
	"tasks",
	"ui",
	"tests",
] as const;

type Folder =
	| "chat"
	| "memories"
	| "permissions"
	| "knowledge"
	| "attachments"
	| "bin"
	| (typeof PLACEHOLDERS)[number];

const FOLDER_ICONS: Record<Folder, IconSvgElement> = {
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
	empty: string | null;
	children: (item: T) => ReactNode;
}) {
	if (items === undefined) return null;
	if (items.length === 0) return empty && <Empty>{empty}</Empty>;
	return items.map(children);
}

function DatedListing<T>({
	items,
	at,
	empty,
	check,
	children,
}: {
	items: T[] | undefined;
	at: (item: T) => number;
	empty: string;
	check: (items: T[]) => TreeCheck;
	children: (item: T) => ReactNode;
}) {
	if (items === undefined) return null;
	if (items.length === 0) return <Empty>{empty}</Empty>;
	return byDate(items, at, Date.now()).map(({ group, items: dated }) => (
		<Fragment key={group}>
			<TreeGroup label={group} check={check(dated)} />
			{dated.map(children)}
		</Fragment>
	));
}

const FOLDERS = [
	"chat",
	"memories",
	"permissions",
	"knowledge",
	"attachments",
	"bin",
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

function useBulk(source: string) {
	const { failure, attempt } = useAttempt(source);
	const [busy, setBusy] = useState(false);
	return {
		failure,
		busy,
		run: (work: () => Promise<unknown>) =>
			attempt(async () => {
				setBusy(true);
				try {
					await work();
				} finally {
					setBusy(false);
				}
			}),
	};
}

function useFileList<T extends { name: string }>(
	files: T[] | undefined,
	source: string,
	at?: (file: T) => number,
) {
	const [query, setQuery] = useState("");
	const found = searched(files, query);
	const shown =
		at === undefined || found === undefined
			? found
			: [...found].sort((a, b) => at(b) - at(a));
	const selection = useSelection(shown?.map((file) => file.name));
	const bulk = useBulk(source);
	return { files, query, setQuery, shown, selection, bulk };
}

type ListedFiles = ReturnType<typeof useFileList>;

function emptyOr(list: ListedFiles, empty: string) {
	return list.query.trim() === "" ? empty : "nothing matches";
}

function FileFilter({ list, label }: { list: ListedFiles; label: string }) {
	if (list.files === undefined || list.files.length === 0) return null;
	return (
		<TreeFilter
			value={list.query}
			onChange={list.setQuery}
			label={label}
			check={list.selection.among(list.shown?.map((file) => file.name) ?? [])}
		/>
	);
}

function Selected({
	list,
	where,
	current,
	leave,
	served,
	confirm,
	onDelete,
	onRestore,
}: {
	list: ListedFiles;
	where: string;
	current: string | undefined;
	leave: (selected: boolean) => Promise<unknown>;
	served: (name: string) => Promise<{ url: string | null } | null>;
	confirm: string;
	onDelete: (names: string[]) => Promise<unknown>;
	onRestore?: (name: string) => Promise<unknown>;
}) {
	const { selection, bulk } = list;
	const names = selection.selected;
	if (names.length === 0) return null;
	const leaving = (work: () => Promise<unknown>) =>
		bulk.run(async () => {
			await leave(current !== undefined && names.includes(current));
			await work();
			selection.clear();
		});

	return (
		<TreeSelection
			count={names.length}
			total={list.shown?.length ?? 0}
			where={where}
			onAll={selection.all}
			onClear={selection.clear}
			busy={bulk.busy}
			failure={bulk.failure}
		>
			<TreeAction
				label="download"
				onRun={() =>
					bulk.run(() =>
						eachOf(names, async (name) => {
							const file = await served(name);
							if (!file?.url) throw new Error("its bytes are gone");
							await saveAs(name, file.url);
						}),
					)
				}
			/>
			{onRestore && (
				<TreeAction
					label="restore"
					onRun={() => leaving(() => eachOf(names, onRestore))}
				/>
			)}
			<TreeAction
				label="delete"
				confirm={confirm}
				danger
				onRun={() => leaving(() => onDelete(names))}
			/>
		</TreeSelection>
	);
}

function KnowledgeFolder({
	workspaceId,
	current,
	folder,
}: {
	workspaceId: Id<"workspaces">;
	current: string | undefined;
	folder: { open: boolean; onToggle: () => void };
}) {
	const { data: files } = useQuery(
		convexQuery(api.knowledge.list, { workspaceId }),
	);
	const queryClient = useQueryClient();
	const removeFile = useConvexMutation(api.knowledge.remove);
	const removeFiles = useConvexMutation(api.knowledge.removeMany);
	const leave = useLeave(workspaceId);
	const picker = useRef<HTMLInputElement>(null);
	const { upload, uploading, failures } = useKnowledgeUpload(workspaceId);
	const list = useFileList(files, "knowledge bulk action");

	return (
		<>
			<input
				ref={picker}
				type="file"
				multiple
				hidden
				onChange={(event) => {
					const picked = event.target.files;
					if (picked === null || picked.length === 0) return;
					if (!folder.open) folder.onToggle();
					void upload([...picked]);
					event.target.value = "";
				}}
			/>
			<TreeFolder
				name="knowledge"
				icon={FOLDER_ICONS.knowledge}
				{...folder}
				onCreate={() => picker.current?.click()}
				createLabel="upload to knowledge/"
			>
				<FileFilter list={list} label="search knowledge" />
				<Selected
					list={list}
					where="knowledge/"
					current={current}
					leave={leave}
					served={(name) =>
						queryClient.fetchQuery(
							convexQuery(api.knowledge.get, { workspaceId, name }),
						)
					}
					confirm="move them to the bin?"
					onDelete={(names) => removeFiles({ workspaceId, names })}
				/>
				<Listing
					items={list.shown}
					empty={
						uploading.length > 0 ? null : emptyOr(list, "no knowledge yet")
					}
				>
					{(file) => (
						<TreeFile
							key={file.name}
							name={file.name}
							icon={knowledgeIcon(file.name, file.contentType)}
							depth={1}
							selected={current === file.name}
							check={list.selection.check(file.name)}
							trailing={
								<FileMenu
									name={file.name}
									confirm="move it to the bin?"
									onDelete={async () => {
										await leave(current === file.name);
										await removeFile({ workspaceId, name: file.name });
									}}
								/>
							}
							link={(content, className) => (
								<Link
									to="/$workspaceId/knowledge/$name"
									params={{ workspaceId, name: file.name }}
									className={className}
								>
									{content}
								</Link>
							)}
						/>
					)}
				</Listing>
				{uploading.map((name) => (
					<TreePending key={name} name={name} label="uploading" depth={1} />
				))}
				{failures.map((failure) => (
					<div key={failure} className="py-1 pl-9 text-red">
						{failure}
					</div>
				))}
			</TreeFolder>
		</>
	);
}

function AttachmentsFolder({
	workspaceId,
	current,
	folder,
}: {
	workspaceId: Id<"workspaces">;
	current: string | undefined;
	folder: { open: boolean; onToggle: () => void };
}) {
	const { data: files } = useQuery({
		...convexQuery(api.attachments.list, { workspaceId }),
		enabled: folder.open,
	});
	const queryClient = useQueryClient();
	const toBin = useConvexMutation(api.attachments.remove);
	const allToBin = useConvexMutation(api.attachments.removeMany);
	const leave = useLeave(workspaceId);
	const list = useFileList(
		files,
		"attachments bulk action",
		(file) => file.attachedAt,
	);

	return (
		<TreeFolder name="attachments" icon={FOLDER_ICONS.attachments} {...folder}>
			<FileFilter list={list} label="search attachments" />
			<Selected
				list={list}
				where="attachments/"
				current={current}
				leave={leave}
				served={(name) =>
					queryClient.fetchQuery(
						convexQuery(api.attachments.get, { workspaceId, name }),
					)
				}
				confirm="move them to the bin?"
				onDelete={(names) => allToBin({ workspaceId, names })}
			/>
			<DatedListing
				items={list.shown}
				at={(file) => file.attachedAt}
				empty={emptyOr(list, "nothing attached lately")}
				check={(dated) => list.selection.among(dated.map((file) => file.name))}
			>
				{(file) => (
					<TreeFile
						key={file.name}
						name={file.name}
						icon={knowledgeIcon(file.name, file.contentType)}
						depth={1}
						selected={current === file.name}
						check={list.selection.check(file.name)}
						trailing={
							<FileMenu
								name={file.name}
								confirm="move it to the bin?"
								onDelete={async () => {
									await leave(current === file.name);
									await toBin({ workspaceId, name: file.name });
								}}
							/>
						}
						link={(content, className) => (
							<Link
								to="/$workspaceId/attachments/$name"
								params={{ workspaceId, name: file.name }}
								className={className}
							>
								{content}
							</Link>
						)}
					/>
				)}
			</DatedListing>
		</TreeFolder>
	);
}

function BinFolder({
	workspaceId,
	current,
	folder,
}: {
	workspaceId: Id<"workspaces">;
	current: string | undefined;
	folder: { open: boolean; onToggle: () => void };
}) {
	const { data: files } = useQuery({
		...convexQuery(api.bin.list, { workspaceId }),
		enabled: folder.open,
	});
	const restore = useConvexMutation(api.bin.restore);
	const removeFile = useConvexMutation(api.bin.remove);
	const removeFiles = useConvexMutation(api.bin.removeMany);
	const queryClient = useQueryClient();
	const leave = useLeave(workspaceId);
	const list = useFileList(files, "bin bulk action", (file) => file.binnedAt);

	return (
		<TreeFolder name="bin" icon={FOLDER_ICONS.bin} {...folder}>
			<FileFilter list={list} label="search the bin" />
			<Selected
				list={list}
				where="bin/"
				current={current}
				leave={leave}
				served={(name) =>
					queryClient.fetchQuery(
						convexQuery(api.bin.get, { workspaceId, name }),
					)
				}
				confirm="delete them for good?"
				onDelete={(names) => removeFiles({ workspaceId, names })}
				onRestore={async (name) => {
					const restored = await restore({ workspaceId, name });
					if ("refused" in restored)
						throw new Error(restoreFailure(restored.refused));
				}}
			/>
			<DatedListing
				items={list.shown}
				at={(file) => file.binnedAt}
				empty={emptyOr(list, "the bin is empty")}
				check={(dated) => list.selection.among(dated.map((file) => file.name))}
			>
				{(file) => (
					<TreeFile
						key={file.name}
						name={file.name}
						icon={knowledgeIcon(file.name, file.contentType)}
						depth={1}
						selected={current === file.name}
						check={list.selection.check(file.name)}
						trailing={
							<FileMenu
								name={file.name}
								confirm="delete this file for good?"
								restoreLabel={`restore to ${file.from}`}
								onRestore={async () => {
									const restored = await restore({
										workspaceId,
										name: file.name,
									});
									if ("refused" in restored)
										throw new Error(restoreFailure(restored.refused));
									await leave(current === file.name);
								}}
								onDelete={async () => {
									await leave(current === file.name);
									await removeFile({ workspaceId, name: file.name });
								}}
							/>
						}
						link={(content, className) => (
							<Link
								to="/$workspaceId/bin/$name"
								params={{ workspaceId, name: file.name }}
								className={className}
							>
								{content}
							</Link>
						)}
					/>
				)}
			</DatedListing>
		</TreeFolder>
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
	const fileFolder = useLocation({
		select: (location) => location.pathname.split("/")[2],
	});
	const { data: memories } = useQuery(
		convexQuery(api.memories.list, { workspaceId }),
	);

	const { shown, reorder } = useSidebarOrder();
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
