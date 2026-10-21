const BAR_ITEMS = ["panes", "clock", "minimized"] as const;

export type BarItem = (typeof BAR_ITEMS)[number];

export type BarPlace = "left" | "centre" | "right";

const PLACES: Record<number, readonly BarPlace[]> = {
	1: ["right"],
	2: ["left", "right"],
	3: ["left", "centre", "right"],
};

export function placeOf(order: readonly BarItem[], item: BarItem): BarPlace {
	return PLACES[order.length]?.[order.indexOf(item)] ?? "right";
}

function isItem(name: string): name is BarItem {
	return (BAR_ITEMS as readonly string[]).includes(name);
}

export function barOrder(saved: readonly string[] | undefined): BarItem[] {
	const kept = [...new Set(saved ?? [])].filter(isItem);
	return [...kept, ...BAR_ITEMS.filter((item) => !kept.includes(item))];
}

export function shownItems(
	order: readonly BarItem[],
	hidden: readonly string[] | undefined,
): BarItem[] {
	const gone = new Set(hidden ?? []);
	return order.filter((item) => !gone.has(item));
}

export function toggledItem(
	hidden: readonly string[] | undefined,
	item: BarItem,
): BarItem[] {
	const kept = [...new Set(hidden ?? [])].filter(isItem);
	return kept.includes(item)
		? kept.filter((held) => held !== item)
		: [...kept, item];
}

export function reorderedShown(
	order: readonly BarItem[],
	next: readonly BarItem[],
): BarItem[] {
	const queue = [...next];
	return order.map((item) =>
		next.includes(item) ? (queue.shift() ?? item) : item,
	);
}
