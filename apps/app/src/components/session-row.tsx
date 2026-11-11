import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import {
	Alert02Icon,
	BubbleChatIcon,
	GitForkIcon,
	Route01Icon,
	StopCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import type { Doc } from "@repo/backend/dataModel";
import { TreeFile } from "@repo/components";
import {
	Dots,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@repo/ui";
import { anchorOf } from "@repo/ui-catalog";
import { useQuery } from "@tanstack/react-query";
import { type CSSProperties, useState } from "react";
import { useAttempt } from "../lib/attempt.ts";
import { abandonChat } from "../lib/chat.tsx";
import { dragsAs, type PanelContent, traceOpen } from "../lib/panel-ops.ts";
import { requestPanelClosed } from "../lib/panel-requests.ts";
import { usePanels } from "../lib/panels.tsx";
import { ConfirmItem } from "./confirm-item.tsx";
import { PanelLink, useShown } from "./panel-link.tsx";

const STATUS_ICONS = {
	waiting: { icon: BubbleChatIcon, iconClassName: "text-yellow" },
	errored: { icon: Alert02Icon, iconClassName: "text-red" },
	stopped: { icon: StopCircleIcon, iconClassName: "text-dim" },
} satisfies Record<
	Exclude<Doc<"chats">["status"], "streaming" | undefined>,
	{ icon: IconSvgElement; iconClassName: string }
>;

export type SessionChat = Pick<
	Doc<"chats">,
	"_id" | "workspaceId" | "title" | "status" | "failure"
>;

function statusGlyph(chat: SessionChat) {
	if (chat.status === undefined) return {};
	if (chat.status === "streaming")
		return {
			glyph: <Dots className="size-icon-sm" label="streaming" />,
			iconLabel: "streaming",
		};
	const label =
		chat.status === "errored" && chat.failure
			? `errored: ${chat.failure}`
			: chat.status;
	return { ...STATUS_ICONS[chat.status], iconLabel: label };
}

const item =
	"rounded-none px-2.5 py-1 text-[11.5px] text-dim focus:bg-bg2 focus:text-fg";

function RenameForm({
	chat,
	onDone,
	attempt,
}: {
	chat: SessionChat;
	onDone: () => void;
	attempt: (run: () => Promise<unknown>) => void;
}) {
	const renameChat = useConvexMutation(api.chats.rename);
	const [title, setTitle] = useState(chat.title);
	return (
		<form
			{...anchorOf("chats/item")}
			className="px-1"
			onSubmit={(event) => {
				event.preventDefault();
				const trimmed = title.trim();
				onDone();
				if (trimmed === "" || trimmed === chat.title) return;
				attempt(() => renameChat({ chatId: chat._id, title: trimmed }));
			}}
		>
			<input
				// biome-ignore lint/a11y/noAutofocus: the field replaces the row the menu opened from
				autoFocus
				value={title}
				onChange={(event) => setTitle(event.target.value)}
				onBlur={onDone}
				onKeyDown={(event) => {
					if (event.key === "Escape") onDone();
				}}
				className="w-full bg-bg2 px-1.5 py-1 text-[11.5px] outline-none"
			/>
		</form>
	);
}

function SessionMenu({
	chat,
	opens,
	onRename,
	attempt,
	deletable,
}: {
	chat: SessionChat;
	opens: PanelContent;
	deletable: boolean;
	onRename: () => void;
	attempt: (run: () => Promise<unknown>) => void;
}) {
	const { apply } = usePanels();
	const removeChat = useConvexMutation(api.chats.remove);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				{...anchorOf("chats/menu")}
				title="session options"
				className="flex-none cursor-pointer px-1.5 py-0.5 text-dim opacity-0 transition hover:text-fg focus:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
			>
				⋯
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				sideOffset={2}
				className="min-w-[9rem] rounded-none border-bg2 bg-bg1 p-0 text-[11.5px] shadow-none"
			>
				<DropdownMenuItem onSelect={onRename} className={item}>
					rename
				</DropdownMenuItem>
				<DropdownMenuItem
					onSelect={() => apply([traceOpen(chat._id)])}
					className={`${item} gap-1.5`}
				>
					<HugeiconsIcon
						icon={Route01Icon}
						className="size-icon-sm flex-none"
					/>
					open trace
				</DropdownMenuItem>
				{deletable && (
					<>
						<DropdownMenuSeparator className="mx-0 my-0 bg-bg2" />
						<ConfirmItem
							label="delete"
							confirm="delete for good?"
							className={`${item} focus:text-red`}
							onConfirm={() => {
								attempt(async () => {
									abandonChat(chat._id);
									requestPanelClosed(opens);
									await removeChat({ chatId: chat._id });
								});
							}}
						/>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function useExpanded(selected: boolean) {
	const [expanded, setExpanded] = useState(selected);
	const [wasSelected, setWasSelected] = useState(selected);
	if (selected !== wasSelected) {
		setWasSelected(selected);
		if (selected) setExpanded(true);
	}
	return { expanded, toggle: () => setExpanded(!expanded) };
}

function ThreadToggle({
	count,
	expanded,
	onToggle,
}: {
	count: number;
	expanded: boolean;
	onToggle: () => void;
}) {
	if (count === 0) return null;
	return (
		<button
			{...anchorOf("chats/sub-agents")}
			type="button"
			aria-expanded={expanded}
			title={`${count} sub-agent${count === 1 ? "" : "s"}`}
			onClick={onToggle}
			className={`flex flex-none cursor-pointer px-0.5 transition hover:text-fg ${expanded ? "text-fg" : "text-dim"}`}
		>
			<HugeiconsIcon icon={GitForkIcon} className="size-icon-xs" />
		</button>
	);
}

function SubAgentRows({
	subAgents,
	depth,
}: {
	subAgents: SessionChat[];
	depth: number;
}) {
	if (subAgents.length === 0) return null;
	return (
		<div
			className="relative before:absolute before:inset-y-0 before:left-[var(--rail)] before:border-bg2 before:border-l"
			style={{ "--rail": `${1.0625 + depth * 0.875}rem` } as CSSProperties}
		>
			{subAgents.map((child) => (
				<SessionRow key={child._id} chat={child} depth={depth + 1} />
			))}
		</div>
	);
}

export function SessionRow({
	chat,
	depth = 1,
}: {
	chat: SessionChat;
	depth?: number;
}) {
	const shown = useShown();
	const name = chat.title === "" ? "untitled" : chat.title;
	const opens: PanelContent = { kind: "chat", chatId: chat._id, title: name };
	const { failure, attempt } = useAttempt("session action");
	const [renaming, setRenaming] = useState(false);
	const selected = shown(opens);
	const { expanded, toggle } = useExpanded(selected);
	const { data: subAgents = [] } = useQuery(
		convexQuery(api.chats.children, { chatId: chat._id }),
	);

	if (renaming) {
		return (
			<RenameForm
				chat={chat}
				onDone={() => setRenaming(false)}
				attempt={attempt}
			/>
		);
	}

	return (
		<>
			<TreeFile
				name={name}
				{...statusGlyph(chat)}
				selected={selected}
				depth={depth}
				onDragStart={dragsAs(opens)}
				link={(content, className) => (
					<PanelLink
						anchor={anchorOf("chats/item")}
						workspaceId={chat.workspaceId}
						content={opens}
						className={className}
						onClick={() => selected && toggle()}
					>
						{content}
					</PanelLink>
				)}
				trailing={
					<>
						<ThreadToggle
							count={subAgents.length}
							expanded={expanded}
							onToggle={toggle}
						/>
						<SessionMenu
							chat={chat}
							opens={opens}
							deletable={depth === 1}
							onRename={() => setRenaming(true)}
							attempt={attempt}
						/>
					</>
				}
			/>
			{failure && (
				<div className="px-2.5 py-1 text-[11px] text-red">{failure}</div>
			)}
			{expanded && <SubAgentRows subAgents={subAgents} depth={depth} />}
		</>
	);
}
