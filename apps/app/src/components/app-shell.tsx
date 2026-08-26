import { LeftSidebar } from "./left-sidebar.tsx";
import { RightSidebar } from "./right-sidebar.tsx";

export function AppShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-screen overflow-hidden bg-bg font-mono text-[13px] leading-[1.7] text-fg">
			<LeftSidebar />
			<main className="flex min-w-[400px] flex-1 flex-col">{children}</main>
			<RightSidebar />
		</div>
	);
}
