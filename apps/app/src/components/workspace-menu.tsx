import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@repo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useWorkspace } from "../lib/workspace.tsx";

const item =
	"rounded-none px-2.5 py-1 text-[11.5px] text-dim focus:bg-bg2 focus:text-fg";

export function WorkspaceMenu() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { workspaces, workspace } = useWorkspace();
	const createWorkspace = useConvexMutation(api.workspaces.create);
	const [naming, setNaming] = useState(false);
	const [name, setName] = useState("");

	const open = (workspaceId: Id<"workspaces">) =>
		navigate({ to: "/$workspaceId", params: { workspaceId } });

	if (naming) {
		return (
			<form
				className="px-1.5"
				onSubmit={async (event) => {
					event.preventDefault();
					const trimmed = name.trim();
					if (!trimmed) return;
					setNaming(false);
					setName("");
					const created = await createWorkspace({ name: trimmed });
					await queryClient.invalidateQueries(
						convexQuery(api.workspaces.list, {}),
					);
					await open(created);
				}}
			>
				<input
					// biome-ignore lint/a11y/noAutofocus: the field replaces the menu the click opened
					autoFocus
					value={name}
					onChange={(event) => setName(event.target.value)}
					onBlur={() => setNaming(false)}
					placeholder="workspace name"
					className="w-full bg-bg2 px-2.5 py-1 text-[11.5px] outline-none"
				/>
			</form>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger className="mx-1.5 flex cursor-pointer items-baseline gap-2 bg-bg2 px-2.5 py-1 text-left text-[11.5px] text-dim hover:text-fg">
				<span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
					{workspace?.name ?? "…"}
				</span>
				<span className="flex-none">▾</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				sideOffset={2}
				className="min-w-[calc(var(--radix-dropdown-menu-trigger-width)/var(--app-zoom))] rounded-none border-bg2 bg-bg1 p-0 text-[11.5px] shadow-none"
			>
				{workspaces.map((candidate) => (
					<DropdownMenuItem
						key={candidate._id}
						onSelect={() => void open(candidate._id)}
						className={item}
					>
						{candidate.name}
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator className="mx-0 my-0 bg-bg2" />
				<DropdownMenuItem onSelect={() => setNaming(true)} className={item}>
					new workspace
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
