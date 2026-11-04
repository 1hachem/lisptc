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

export type SidebarSide = "left" | "right";

export type SidebarSides = Readonly<
	Record<SidebarSide, readonly SidebarEntry[]>
>;

export const RIGHT_BY_DEFAULT: readonly SidebarEntry[] = [
	"memories",
	"permissions",
	"sub-agents",
	"triggers",
	"tasks",
	"ui",
	"tests",
];

function entriesIn(stored: readonly string[] | undefined): SidebarEntry[] {
	return [...new Set(currentNames(stored))].filter(isEntry);
}

export function sidebarSides(
	left: readonly string[] | undefined,
	right: readonly string[] | undefined,
): SidebarSides {
	const onRight =
		right === undefined ? [...RIGHT_BY_DEFAULT] : entriesIn(right);
	const onLeft = entriesIn(left).filter((name) => !onRight.includes(name));
	const unplaced = SIDEBAR_ENTRIES.filter(
		(name) => !onLeft.includes(name) && !onRight.includes(name),
	);
	return {
		left: [
			...onLeft,
			...unplaced.filter((name) => !RIGHT_BY_DEFAULT.includes(name)),
		],
		right: [
			...onRight,
			...unplaced.filter((name) => RIGHT_BY_DEFAULT.includes(name)),
		],
	};
}

export function shownEntries(
	order: readonly SidebarEntry[],
	hidden: readonly string[] | undefined,
): SidebarEntry[] {
	const gone = new Set(currentNames(hidden));
	return order.filter((name) => !gone.has(name));
}

export function withHiddenSides(
	shown: SidebarSides,
	previous: SidebarSides,
): SidebarSides {
	const placed = new Set([...shown.left, ...shown.right]);
	return {
		left: [...shown.left, ...previous.left.filter((name) => !placed.has(name))],
		right: [
			...shown.right,
			...previous.right.filter((name) => !placed.has(name)),
		],
	};
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
