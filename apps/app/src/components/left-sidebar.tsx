import { convexQuery } from "@convex-dev/react-query";
import { Logout01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useWorkspace } from "../lib/workspace.tsx";
import { SidePanel } from "./side-panel.tsx";
import { WorkspaceMenu } from "./workspace-menu.tsx";
import { WorkspaceTree } from "./workspace-tree.tsx";

export function LeftSidebar({
	open,
	onSignOut,
}: {
	open: boolean;
	onSignOut: () => void;
}) {
	const { data: user } = useQuery(convexQuery(api.users.me, {}));
	const { workspace } = useWorkspace();

	return (
		<SidePanel side="left" open={open} className="w-[214px]">
			<div className="flex h-full flex-col gap-3.5 py-3.5">
				<div aria-hidden className="invisible px-4">
					«
				</div>

				<WorkspaceMenu />

				<div className="min-h-0 flex-1 overflow-y-auto px-1.5 text-[11.5px]">
					{workspace && <WorkspaceTree workspaceId={workspace._id} />}
				</div>

				<div className="flex items-center gap-2 px-2.5 text-[11px] text-dim">
					<span
						className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
						title={user?.email}
					>
						{user === undefined
							? ""
							: user.name === ""
								? user.email
								: user.name}
					</span>
					{workspace && (
						<Link
							to="/$workspaceId/account"
							params={{ workspaceId: workspace._id }}
							className="ml-auto flex-none text-dim hover:text-fg"
							activeProps={{ className: "text-fg" }}
							title="settings"
							aria-label="settings"
						>
							<HugeiconsIcon className="size-icon-sm" icon={Settings01Icon} />
						</Link>
					)}
					<button
						type="button"
						onClick={onSignOut}
						title="sign out"
						aria-label="sign out"
						className="flex-none cursor-pointer text-dim hover:text-fg"
					>
						<HugeiconsIcon className="size-icon-sm" icon={Logout01Icon} />
					</button>
				</div>
			</div>
		</SidePanel>
	);
}
