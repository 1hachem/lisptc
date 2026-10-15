export const SIDEBAR_ENTRIES = [
	"home",
	"new_chat",
	"chat",
	"memories",
	"permissions",
	"knowledge",
	"agents",
	"triggers",
	"tasks",
	"ui",
	"README.md",
	"settings.ptc",
	"preferences.ptc",
] as const;

export type SidebarEntry = (typeof SIDEBAR_ENTRIES)[number];

function isEntry(name: string): name is SidebarEntry {
	return (SIDEBAR_ENTRIES as readonly string[]).includes(name);
}

export function sidebarOrder(
	stored: readonly string[] | undefined,
): SidebarEntry[] {
	const kept = [...new Set(stored ?? [])].filter(isEntry);
	return [...kept, ...SIDEBAR_ENTRIES.filter((name) => !kept.includes(name))];
}
