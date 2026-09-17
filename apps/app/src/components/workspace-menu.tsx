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
import { useAttempt } from "../lib/attempt.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { ConfirmItem } from "./confirm-item.tsx";

const item =
	"rounded-none px-2.5 py-1 text-[11.5px] text-dim focus:bg-bg2 focus:text-fg";

type Editing = "create" | "rename";

export function WorkspaceMenu() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { workspaces, workspace } = useWorkspace();
	const createWorkspace = useConvexMutation(api.workspaces.create);
	const renameWorkspace = useConvexMutation(api.workspaces.rename);
	const removeWorkspace = useConvexMutation(api.workspaces.remove);
	const { failure, attempt } = useAttempt("workspace action");
	const [editing, setEditing] = useState<Editing | null>(null);
	const [name, setName] = useState("");

	const open = (workspaceId: Id<"workspaces">) =>
		navigate({ to: "/$workspaceId", params: { workspaceId } });

	const refresh = () =>
		queryClient.invalidateQueries(convexQuery(api.workspaces.list, {}));

	if (editing !== null) {
		return (
			<form
				className="px-1.5"
				onSubmit={(event) => {
					event.preventDefault();
					const trimmed = name.trim();
					const mode = editing;
					setEditing(null);
					setName("");
					if (!trimmed) return;
					attempt(async () => {
						if (mode === "rename") {
							if (!workspace || trimmed === workspace.name) return;
							await renameWorkspace({
								workspaceId: workspace._id,
								name: trimmed,
							});
							await refresh();
							return;
						}
						const created = await createWorkspace({ name: trimmed });
						await refresh();
						await open(created);
					});
				}}
			>
				<input
					// biome-ignore lint/a11y/noAutofocus: the field replaces the menu the click opened
					autoFocus
					value={name}
					onChange={(event) => setName(event.target.value)}
					onBlur={() => setEditing(null)}
					onKeyDown={(event) => {
						if (event.key === "Escape") setEditing(null);
					}}
					placeholder="workspace name"
					className="w-full bg-bg2 px-2.5 py-1 text-[11.5px] outline-none"
				/>
			</form>
		);
	}

	return (
		<>
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
					<DropdownMenuItem
						onSelect={() => {
							setName("");
							setEditing("create");
						}}
						className={item}
					>
						new workspace
					</DropdownMenuItem>
					{workspace && (
						<>
							<DropdownMenuItem
								onSelect={() => {
									setName(workspace.name);
									setEditing("rename");
								}}
								className={item}
							>
								rename workspace
							</DropdownMenuItem>
							<ConfirmItem
								label="delete workspace"
								confirm="delete it and every session?"
								className={`${item} focus:text-red`}
								onConfirm={() => {
									attempt(async () => {
										const landing = await removeWorkspace({
											workspaceId: workspace._id,
										});
										await refresh();
										await open(landing);
									});
								}}
							/>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{failure && (
				<div className="px-2.5 py-1 text-[11px] text-red">{failure}</div>
			)}
		</>
	);
}
