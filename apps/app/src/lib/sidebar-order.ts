export const SIDEBAR_ENTRIES = [
	"home",
	"new_chat",
	"chat",
	"memories",
	"permissions",
	"knowledge",
	"sub-agents",
	"triggers",
	"tasks",
	"ui",
	"README.md",
	"settings.ptc",
	"preferences.ptc",
] as const;

export type SidebarEntry = (typeof SIDEBAR_ENTRIES)[number];

const RENAMED: Readonly<Record<string, SidebarEntry>> = {
	agents: "sub-agents",
};

function isEntry(name: string): name is SidebarEntry {
	return (SIDEBAR_ENTRIES as readonly string[]).includes(name);
}

export function sidebarOrder(
	stored: readonly string[] | undefined,
): SidebarEntry[] {
	const kept = [
		...new Set((stored ?? []).map((name) => RENAMED[name] ?? name)),
	].filter(isEntry);
	return [...kept, ...SIDEBAR_ENTRIES.filter((name) => !kept.includes(name))];
}
