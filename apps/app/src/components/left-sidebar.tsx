import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useNewChat } from "../lib/chats.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { SessionRow } from "./session-row.tsx";
import { SidePanel } from "./side-panel.tsx";
import { WorkspaceMenu } from "./workspace-menu.tsx";

export function LeftSidebar({
	open,
	onSignOut,
}: {
	open: boolean;
	onSignOut: () => void;
}) {
	const newChat = useNewChat();
	const { data: user } = useQuery(convexQuery(api.users.me, {}));
	const { workspace } = useWorkspace();
	const current = useParams({ strict: false }).chatId;
	const { data: chats } = useQuery(
		convexQuery(
			api.chats.list,
			workspace ? { workspaceId: workspace._id } : "skip",
		),
	);

	return (
		<SidePanel side="left" open={open} className="w-[214px]">
			<div className="flex h-full flex-col gap-3.5 py-3.5">
				<div aria-hidden className="invisible px-4">
					«
				</div>

				<WorkspaceMenu />

				<div className="flex flex-col gap-[3px] px-1.5">
					<button
						type="button"
						onClick={() => void newChat()}
						className="flex cursor-pointer items-baseline gap-2 border-b-2 border-b-bg bg-bg2 px-2.5 py-1 text-left text-blue transition hover:brightness-125 active:translate-y-0.5 active:border-b-0 active:pt-1.5"
					>
						<span className="w-[11px] flex-none text-center text-[11px]">
							›
						</span>
						<span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
							new session
						</span>
					</button>
				</div>

				<div className="px-4 text-[11px] uppercase tracking-[0.14em] text-dim">
					sessions
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-1.5 text-[11.5px]">
					{chats === undefined ? null : chats.length === 0 ? (
						<div className="px-2.5 text-dim">no sessions yet</div>
					) : (
						chats.map((chat) => (
							<SessionRow
								key={chat._id}
								chat={chat}
								current={chat._id === current}
							/>
						))
					)}
				</div>

				<div className="flex items-baseline gap-2 px-2.5 text-[11px] text-dim">
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
					<button
						type="button"
						onClick={onSignOut}
						className="flex-none cursor-pointer text-dim hover:text-fg"
					>
						sign out
					</button>
				</div>
			</div>
		</SidePanel>
	);
}
