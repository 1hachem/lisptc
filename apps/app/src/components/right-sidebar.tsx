import { Sidebar } from "@repo/ui";
import { useUI } from "../lib/ui.tsx";

export function RightSidebar() {
	const { setRightOpen } = useUI();

	return (
		<Sidebar side="right" collapsible="offcanvas" className="border-l-0!">
			<div className="flex h-full flex-col gap-5 py-3.5">
				<div className="flex items-baseline gap-2 px-4">
					<span className="flex-1 text-[11px] uppercase tracking-[0.14em] text-dim">
						panel
					</span>
					<button
						type="button"
						onClick={() => setRightOpen(false)}
						title="collapse"
						className="flex-none text-dim hover:text-fg"
					>
						»
					</button>
				</div>
				<div className="px-4 text-[11.5px] text-dim">nothing here yet</div>
			</div>
		</Sidebar>
	);
}
