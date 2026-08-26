import { SidebarProvider } from "@repo/ui";
import { useUI } from "../lib/ui.tsx";
import { LeftSidebar } from "./left-sidebar.tsx";
import { RightSidebar } from "./right-sidebar.tsx";

export function AppShell({ children }: { children: React.ReactNode }) {
	const { leftOpen, setLeftOpen, rightOpen, setRightOpen } = useUI();

	return (
		<SidebarProvider
			open={leftOpen}
			onOpenChange={setLeftOpen}
			style={
				{
					"--sidebar-width": "214px",
					"--sidebar-width-icon": "34px",
				} as React.CSSProperties
			}
			className="h-screen overflow-hidden bg-bg font-mono text-[13px] text-fg leading-[1.7]"
		>
			<LeftSidebar />
			<SidebarProvider
				open={rightOpen}
				onOpenChange={setRightOpen}
				style={
					{
						"--sidebar-width": "268px",
						"--sidebar-width-icon": "34px",
					} as React.CSSProperties
				}
				className="min-h-0 min-w-0 flex-1"
			>
				<main className="flex min-w-0 flex-1 flex-col">{children}</main>
				<RightSidebar />
			</SidebarProvider>
		</SidebarProvider>
	);
}
