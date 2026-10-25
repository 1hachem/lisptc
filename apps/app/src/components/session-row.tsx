import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import {
	Alert02Icon,
	BubbleChatIcon,
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
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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

function SubAgentRows({ chat, depth }: { chat: SessionChat; depth: number }) {
	const { data } = useQuery(
		convexQuery(api.chats.children, { chatId: chat._id }),
	);
	return data?.map((child) => (
		<SessionRow key={child._id} chat={child} depth={depth} />
	));
}

export function SessionRow({
	chat,
	depth = 1,
}: {
	chat: SessionChat;
	depth?: number;
}) {
	const shown = useShown();
	const { apply } = usePanels();
	const opens: PanelContent = {
		kind: "chat",
		chatId: chat._id,
		title: chat.title === "" ? "untitled" : chat.title,
	};
	const renameChat = useConvexMutation(api.chats.rename);
	const removeChat = useConvexMutation(api.chats.remove);
	const { failure, attempt } = useAttempt("session action");
	const [renaming, setRenaming] = useState(false);
	const [title, setTitle] = useState(chat.title);

	if (renaming) {
		return (
			<form
				className="px-1"
				onSubmit={(event) => {
					event.preventDefault();
					const trimmed = title.trim();
					setRenaming(false);
					if (trimmed === "" || trimmed === chat.title) return;
					attempt(() => renameChat({ chatId: chat._id, title: trimmed }));
				}}
			>
				<input
					// biome-ignore lint/a11y/noAutofocus: the field replaces the row the menu opened from
					autoFocus
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					onBlur={() => setRenaming(false)}
					onKeyDown={(event) => {
						if (event.key === "Escape") setRenaming(false);
					}}
					className="w-full bg-bg2 px-1.5 py-1 text-[11.5px] outline-none"
				/>
			</form>
		);
	}

	return (
		<>
			<TreeFile
				name={chat.title === "" ? "untitled" : chat.title}
				{...statusGlyph(chat)}
				selected={shown(opens)}
				depth={depth}
				onDragStart={dragsAs(opens)}
				link={(content, className) => (
					<PanelLink
						workspaceId={chat.workspaceId}
						content={opens}
						className={className}
					>
						{content}
					</PanelLink>
				)}
				trailing={
					<DropdownMenu>
						<DropdownMenuTrigger
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
							<DropdownMenuItem
								onSelect={() => {
									setTitle(chat.title);
									setRenaming(true);
								}}
								className={item}
							>
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
						</DropdownMenuContent>
					</DropdownMenu>
				}
			/>
			{failure && (
				<div className="px-2.5 py-1 text-[11px] text-red">{failure}</div>
			)}
			<SubAgentRows chat={chat} depth={depth + 1} />
		</>
	);
}
