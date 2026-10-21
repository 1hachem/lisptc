import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { WORKSPACE_ICONS } from "@repo/backend/workspace-icons";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@repo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAttempt } from "../lib/attempt.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { ICONS, workspaceIcon } from "../lib/workspace-icons.ts";
import { ConfirmItem } from "./confirm-item.tsx";

const item =
	"rounded-none px-2.5 py-1 text-[11.5px] text-dim focus:bg-bg2 focus:text-fg";

const menu = "rounded-none border-bg2 bg-bg1 p-0 text-[11.5px] shadow-none";

function WorkspaceItems() {
	const navigate = useNavigate();
	const { workspaces } = useWorkspace();
	return workspaces.map((candidate) => (
		<DropdownMenuItem
			key={candidate._id}
			onSelect={() =>
				void navigate({
					to: "/$workspaceId",
					params: { workspaceId: candidate._id },
				})
			}
			className={item}
		>
			<HugeiconsIcon
				className="size-icon-sm flex-none"
				icon={ICONS[workspaceIcon(candidate)]}
			/>
			<span className="truncate">{candidate.name}</span>
		</DropdownMenuItem>
	));
}

function IconPicker() {
	const { workspace } = useWorkspace();
	const mutation = useConvexMutation(api.workspaces.setIcon);
	const setIcon = useMemo(
		() =>
			mutation.withOptimisticUpdate((store, { workspaceId, icon }) => {
				const list = store.getQuery(api.workspaces.list, {});
				if (list !== undefined) {
					store.setQuery(
						api.workspaces.list,
						{},
						list.map((candidate) =>
							candidate._id === workspaceId
								? { ...candidate, icon }
								: candidate,
						),
					);
				}
				const single = store.getQuery(api.workspaces.get, { workspaceId });
				if (single !== undefined) {
					store.setQuery(
						api.workspaces.get,
						{ workspaceId },
						{ ...single, icon },
					);
				}
			}),
		[mutation],
	);
	if (!workspace) return null;
	const current = workspaceIcon(workspace);
	return (
		<div className="grid grid-cols-6 gap-px p-1">
			{WORKSPACE_ICONS.map((icon) => (
				<DropdownMenuItem
					key={icon}
					title={icon}
					aria-label={`use the ${icon} icon`}
					onSelect={() => void setIcon({ workspaceId: workspace._id, icon })}
					className={`justify-center rounded-none p-1 focus:bg-bg2 ${icon === current ? "bg-bg2 text-fg" : "text-dim"}`}
				>
					<HugeiconsIcon className="size-icon-sm" icon={ICONS[icon]} />
				</DropdownMenuItem>
			))}
		</div>
	);
}

export function WorkspaceRailMenu({ onCreate }: { onCreate: () => void }) {
	const { workspace } = useWorkspace();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="switch workspace"
				title={workspace?.name ?? "workspace"}
				className="flex size-6 cursor-pointer items-center justify-center rounded-md bg-bg2 text-fg hover:text-fg"
			>
				{workspace && (
					<HugeiconsIcon
						className="size-icon-sm"
						icon={ICONS[workspaceIcon(workspace)]}
					/>
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent side="right" align="start" className={menu}>
				<WorkspaceItems />
				<DropdownMenuSeparator className="mx-0 my-0 bg-bg2" />
				<DropdownMenuItem onSelect={onCreate} className={item}>
					<HugeiconsIcon className="size-icon-sm flex-none" icon={Add01Icon} />
					new workspace
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

type Editing = "create" | "rename";

export function WorkspaceMenu({
	startCreating = false,
}: {
	startCreating?: boolean;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { workspace } = useWorkspace();
	const createWorkspace = useConvexMutation(api.workspaces.create);
	const renameWorkspace = useConvexMutation(api.workspaces.rename);
	const removeWorkspace = useConvexMutation(api.workspaces.remove);
	const { failure, attempt } = useAttempt("workspace action");
	const [editing, setEditing] = useState<Editing | null>(
		startCreating ? "create" : null,
	);
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
			<div className="mx-1.5 flex items-stretch gap-[3px]">
				<DropdownMenu>
					<DropdownMenuTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 bg-bg2 px-2.5 py-1 text-left text-[11.5px] text-dim hover:text-fg">
						{workspace && (
							<HugeiconsIcon
								className="size-icon-sm flex-none text-fg"
								icon={ICONS[workspaceIcon(workspace)]}
							/>
						)}
						<span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
							{workspace?.name ?? "…"}
						</span>
						<span className="flex-none">▾</span>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						sideOffset={2}
						className={`min-w-[calc(var(--radix-dropdown-menu-trigger-width)/var(--app-zoom))] ${menu}`}
					>
						<WorkspaceItems />
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
								<DropdownMenuSeparator className="mx-0 my-0 bg-bg2" />
								<IconPicker />
								<DropdownMenuSeparator className="mx-0 my-0 bg-bg2" />
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
				<button
					type="button"
					title="new workspace"
					onClick={() => {
						setName("");
						setEditing("create");
					}}
					className="flex flex-none cursor-pointer items-center bg-bg2 px-2 text-dim hover:text-fg"
				>
					<HugeiconsIcon className="size-icon-sm" icon={Add01Icon} />
				</button>
			</div>
			{failure && (
				<div className="px-2.5 py-1 text-[11px] text-red">{failure}</div>
			)}
		</>
	);
}
