import { Sidebar, useSidebar } from "@repo/ui";

export function RightSidebar() {
	const { state, toggleSidebar } = useSidebar();
	const collapsed = state === "collapsed";

	return (
		<Sidebar side="right" collapsible="icon" className="border-l-0!">
			{collapsed ? (
				<div className="flex h-full flex-col items-center py-3.5">
					<button
						type="button"
						onClick={toggleSidebar}
						title="expand panel"
						className="text-dim hover:text-fg"
					>
						«
					</button>
				</div>
			) : (
				<div className="flex h-full flex-col gap-5 py-3.5">
					<div className="flex items-baseline gap-2 px-4">
						<span className="flex-1 text-[11px] uppercase tracking-[0.14em] text-dim">
							panel
						</span>
						<button
							type="button"
							onClick={toggleSidebar}
							title="collapse panel"
							className="flex-none text-dim hover:text-fg"
						>
							»
						</button>
					</div>
					<div className="px-4 text-[11.5px] text-dim">nothing here yet</div>
				</div>
			)}
		</Sidebar>
	);
}
