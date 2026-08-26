import { useUI } from "../lib/ui.tsx";

export function RightSidebar() {
	const { rightOpen, closeRight } = useUI();
	if (!rightOpen) return null;

	return (
		<div className="flex w-[268px] min-w-[220px] flex-none flex-col gap-5 overflow-y-auto bg-bg1 py-3.5">
			<div className="flex items-baseline gap-2 px-4">
				<span className="flex-1 text-[11px] uppercase tracking-[0.14em] text-dim">
					panel
				</span>
				<button
					type="button"
					onClick={closeRight}
					title="collapse"
					className="flex-none text-dim hover:text-fg"
				>
					»
				</button>
			</div>
			<div className="px-4 text-[11.5px] text-dim">nothing here yet</div>
		</div>
	);
}
