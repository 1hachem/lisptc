import { SidebarProvider } from "@repo/ui";
import type { CSSProperties } from "react";
import { useNoSwipeNavigation } from "../lib/swipe-guard.ts";
import { useUI } from "../lib/ui.tsx";
import { LeftSidebar } from "./left-sidebar.tsx";
import { Onboarding } from "./onboarding.tsx";
import { PreferencesPanel } from "./preferences-panel.tsx";

const SIDEBAR_SIZE = {
	"--sidebar-width": "190px",
	"--sidebar-width-icon": "2rem",
} as CSSProperties;

export function AppShell({
	children,
	onSignOut,
}: {
	children: React.ReactNode;
	onSignOut: () => void;
}) {
	const { leftOpen, setLeftOpen, rightOpen, setRightOpen } = useUI();
	useNoSwipeNavigation();

	return (
		<div className="h-full overflow-hidden bg-bg font-mono text-[13px] text-fg leading-[1.7]">
			<SidebarProvider
				open={leftOpen}
				onOpenChange={setLeftOpen}
				style={SIDEBAR_SIZE}
				className="h-full min-h-0"
			>
				<LeftSidebar onSignOut={onSignOut} />
				<SidebarProvider
					open={rightOpen}
					onOpenChange={setRightOpen}
					shortcut={null}
					style={SIDEBAR_SIZE}
					className="h-full min-h-0 min-w-0 flex-1"
				>
					<main className="flex h-full min-w-0 flex-1 flex-col">
						{children}
					</main>
					<PreferencesPanel />
				</SidebarProvider>
			</SidebarProvider>
			<Onboarding />
		</div>
	);
}
