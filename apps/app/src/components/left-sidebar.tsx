import { Sidebar, useSidebar } from "@repo/ui";
import { clearMessages } from "../lib/chat.ts";
import { useUI } from "../lib/ui.tsx";

export function LeftSidebar() {
	const { state, toggleSidebar } = useSidebar();
	const { toggleRight, rightOpen } = useUI();
	const collapsed = state === "collapsed";

	return (
		<Sidebar side="left" collapsible="icon" className="border-r-0!">
			{collapsed ? (
				<div className="flex h-full flex-col items-center gap-3.5 py-3.5">
					<button
						type="button"
						onClick={clearMessages}
						title="new session"
						className="text-blue hover:brightness-125"
					>
						+
					</button>
					<button
						type="button"
						onClick={toggleSidebar}
						title="expand sidebar"
						className="mt-auto text-dim hover:text-fg"
					>
						»
					</button>
				</div>
			) : (
				<div className="flex h-full flex-col gap-3.5 py-3.5">
					<div className="px-4 text-orange">ptc</div>

					<div className="flex flex-col gap-[3px] px-1.5">
						<button
							type="button"
							onClick={clearMessages}
							className="flex items-baseline gap-2 border-b-2 border-b-bg bg-bg2 px-2.5 py-1 text-left text-blue transition hover:brightness-125 active:translate-y-0.5 active:border-b-0 active:pt-1.5"
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
					<div className="min-h-0 flex-1 overflow-y-auto px-4 text-[11.5px] text-dim">
						no sessions yet
					</div>

					<div className="flex items-baseline gap-2 px-2.5 text-[11px] text-dim">
						<button
							type="button"
							onClick={toggleRight}
							className={`flex-none whitespace-nowrap hover:text-fg ${
								rightOpen ? "text-aqua" : "text-dim"
							}`}
						>
							panel
						</button>
						<button
							type="button"
							onClick={toggleSidebar}
							title="collapse sidebar"
							className="ml-auto flex-none text-dim hover:text-fg"
						>
							«
						</button>
					</div>
				</div>
			)}
		</Sidebar>
	);
}
