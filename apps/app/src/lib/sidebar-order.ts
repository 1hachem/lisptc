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

const RENAMED: Readonly<Record<string, SidebarEntry>> = {
	"settings.ptc": "settings",
	"preferences.ptc": "preferences",
};

function isEntry(name: string): name is SidebarEntry {
	return (SIDEBAR_ENTRIES as readonly string[]).includes(name);
}

export function currentNames(stored: readonly string[] | undefined): string[] {
	return (stored ?? []).map((name) => RENAMED[name] ?? name);
}

export function sidebarOrder(
	stored: readonly string[] | undefined,
): SidebarEntry[] {
	const kept = [...new Set(currentNames(stored))].filter(isEntry);
	return [...kept, ...SIDEBAR_ENTRIES.filter((name) => !kept.includes(name))];
}

export function shownEntries(
	order: readonly SidebarEntry[],
	hidden: readonly string[] | undefined,
): SidebarEntry[] {
	const gone = new Set(currentNames(hidden));
	return order.filter((name) => !gone.has(name));
}

export function withHidden(
	shown: readonly SidebarEntry[],
	order: readonly SidebarEntry[],
): SidebarEntry[] {
	return [...shown, ...order.filter((name) => !shown.includes(name))];
}

export function toggledEntry(
	hidden: readonly string[] | undefined,
	entry: SidebarEntry,
): SidebarEntry[] {
	const kept = [...new Set(currentNames(hidden))].filter(isEntry);
	return kept.includes(entry)
		? kept.filter((held) => held !== entry)
		: [...kept, entry];
}
