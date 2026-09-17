import { useUI } from "../lib/ui.tsx";
import { LeftSidebar, type SignedInUser } from "./left-sidebar.tsx";
import { RightSidebar } from "./right-sidebar.tsx";

function PanelToggle({
	side,
	open,
	onToggle,
}: {
	side: "left" | "right";
	open: boolean;
	onToggle: () => void;
}) {
	const noun = side === "left" ? "sidebar" : "panel";
	const points = side === "left" ? open : !open;
	return (
		<button
			type="button"
			onClick={onToggle}
			title={`${open ? "collapse" : "expand"} ${noun}`}
			className={`absolute top-3.5 z-30 cursor-pointer text-dim hover:text-fg ${
				side === "left" ? "left-4" : "right-4"
			}`}
		>
			{points ? "«" : "»"}
		</button>
	);
}

export function AppShell({
	children,
	user,
	onSignOut,
}: {
	children: React.ReactNode;
	user: SignedInUser;
	onSignOut: () => void;
}) {
	const { leftOpen, toggleLeft, rightOpen, toggleRight } = useUI();

	return (
		<div className="relative h-full overflow-hidden bg-bg font-mono text-[13px] text-fg leading-[1.7]">
			<main className="flex h-full min-w-0 flex-col">{children}</main>
			<LeftSidebar open={leftOpen} user={user} onSignOut={onSignOut} />
			<RightSidebar open={rightOpen} />
			<PanelToggle side="left" open={leftOpen} onToggle={toggleLeft} />
			<PanelToggle side="right" open={rightOpen} onToggle={toggleRight} />
		</div>
	);
}
