const BAR_ITEMS = ["panes", "clock"] as const;

export type BarItem = (typeof BAR_ITEMS)[number];

export const GAP = "gap";

export type BarSlot = BarItem | typeof GAP;

export type BarPlace = "left" | "centre" | "right";

const PLACES: readonly BarPlace[] = ["left", "centre", "right"];

export function placeOf(order: readonly BarSlot[], slot: BarSlot): BarPlace {
	return PLACES[order.indexOf(slot)] ?? "right";
}

function isItem(name: string): name is BarItem {
	return (BAR_ITEMS as readonly string[]).includes(name);
}

function isSlot(name: string): name is BarSlot {
	return name === GAP || isItem(name);
}

export function barOrder(saved: readonly string[] | undefined): BarSlot[] {
	const kept = [...new Set(saved ?? [])].filter(isSlot);
	const order = [...kept, ...BAR_ITEMS.filter((item) => !kept.includes(item))];
	while (order.length < PLACES.length) order.splice(1, 0, GAP);
	return order;
}

export function shownItems(
	order: readonly BarSlot[],
	hidden: readonly string[] | undefined,
): BarItem[] {
	const gone = new Set(hidden ?? []);
	return order.filter(
		(slot): slot is BarItem => isItem(slot) && !gone.has(slot),
	);
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
