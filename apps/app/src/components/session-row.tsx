import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Doc } from "@repo/backend/dataModel";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@repo/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ConfirmItem } from "./confirm-item.tsx";

const item =
	"rounded-none px-2.5 py-1 text-[11.5px] text-dim focus:bg-bg2 focus:text-fg";

export function SessionRow({
	chat,
	current,
}: {
	chat: Doc<"chats">;
	current: boolean;
}) {
	const navigate = useNavigate();
	const renameChat = useConvexMutation(api.chats.rename);
	const removeChat = useConvexMutation(api.chats.remove);
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
					void renameChat({ chatId: chat._id, title: trimmed });
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
		<div className="group/row flex items-baseline">
			<Link
				to="/$workspaceId/$chatId"
				params={{ workspaceId: chat.workspaceId, chatId: chat._id }}
				className={`min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap px-2.5 py-1 ${
					current ? "text-fg" : "text-dim hover:text-fg"
				}`}
			>
				{chat.title === "" ? "untitled" : chat.title}
			</Link>
			<DropdownMenu>
				<DropdownMenuTrigger
					title="session options"
					className="flex-none cursor-pointer px-1.5 py-1 text-dim opacity-0 transition hover:text-fg focus:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
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
					<DropdownMenuSeparator className="mx-0 my-0 bg-bg2" />
					<ConfirmItem
						label="delete"
						confirm="delete for good?"
						className={`${item} focus:text-red`}
						onConfirm={() => {
							void (async () => {
								if (current) {
									await navigate({
										to: "/$workspaceId",
										params: { workspaceId: chat.workspaceId },
										replace: true,
									});
								}
								await removeChat({ chatId: chat._id });
							})();
						}}
					/>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
