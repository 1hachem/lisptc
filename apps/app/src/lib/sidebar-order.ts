export const SIDEBAR_FOLDERS = [
	"chat",
	"memories",
	"permissions",
	"knowledge",
	"attachments",
	"bin",
	"sub-agents",
	"triggers",
	"tasks",
	"ui",
	"tests",
] as const;

export type SidebarFolder = (typeof SIDEBAR_FOLDERS)[number];

export const SIDEBAR_ENTRIES = [
	"home",
	"new_chat",
	...SIDEBAR_FOLDERS,
	"README.md",
	"settings",
	"preferences",
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

export function shownEntries(
	order: readonly SidebarEntry[],
	hidden: readonly string[] | undefined,
): SidebarEntry[] {
	const gone = new Set(hidden ?? []);
	return order.filter((name) => !gone.has(name));
}

export function withHidden(
	shown: readonly SidebarEntry[],
	order: readonly SidebarEntry[],
): SidebarEntry[] {
	return [...shown, ...order.filter((name) => !shown.includes(name))];
}
