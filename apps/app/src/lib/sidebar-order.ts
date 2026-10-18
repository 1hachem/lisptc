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
	"tests",
	"README.md",
	"settings.ptc",
	"preferences.ptc",
	"landing-page.ptc",
] as const;

export type SidebarEntry = (typeof SIDEBAR_ENTRIES)[number];

const VERTICAL_OWNER_ENTRIES: readonly SidebarEntry[] = ["landing-page.ptc"];

export function entriesFor<T extends string>(
	entries: readonly T[],
	verticalOwner: boolean,
): T[] {
	return verticalOwner
		? [...entries]
		: entries.filter(
				(name) => !(VERTICAL_OWNER_ENTRIES as readonly string[]).includes(name),
			);
}

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

export function shownEntries(
	order: readonly SidebarEntry[],
	hidden: readonly string[] | undefined,
): SidebarEntry[] {
	const gone = new Set((hidden ?? []).map((name) => RENAMED[name] ?? name));
	return order.filter((name) => !gone.has(name));
}

export function withHidden(
	shown: readonly SidebarEntry[],
	order: readonly SidebarEntry[],
): SidebarEntry[] {
	return [...shown, ...order.filter((name) => !shown.includes(name))];
}
