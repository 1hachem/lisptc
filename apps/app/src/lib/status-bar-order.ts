const BAR_ITEMS = ["panes", "desktop", "clock"] as const;

export type BarItem = (typeof BAR_ITEMS)[number];

export const SLOT_COUNT = 7;

const GAPS = Array.from(
	{ length: SLOT_COUNT - BAR_ITEMS.length },
	(_, index) => `gap-${index + 1}`,
);

const LEGACY_GAP = "gap";

export type BarSlot = BarItem | `gap-${number}`;

export function isGap(slot: string): slot is `gap-${number}` {
	return GAPS.includes(slot);
}

export function placeOf(order: readonly BarSlot[], slot: BarSlot): number {
	const index = order.indexOf(slot);
	return index < 0 ? SLOT_COUNT : index + 1;
}

function isItem(name: string): name is BarItem {
	return (BAR_ITEMS as readonly string[]).includes(name);
}

function isSlot(name: string): name is BarSlot {
	return isGap(name) || isItem(name);
}

function withGapIds(saved: readonly string[]): string[] {
	const free = GAPS.filter((gap) => !saved.includes(gap));
	return saved.map((name) =>
		name === LEGACY_GAP ? (free.shift() ?? LEGACY_GAP) : name,
	);
}

export function barOrder(saved: readonly string[] | undefined): BarSlot[] {
	const kept: BarSlot[] = [...new Set(withGapIds(saved ?? []))].filter(isSlot);
	const order: BarSlot[] = kept.length === 0 ? [...BAR_ITEMS] : kept;
	for (const item of BAR_ITEMS) {
		if (!order.includes(item)) order.splice(order.length - 1, 0, item);
	}
	const missing = GAPS.filter((gap) => !order.includes(gap as BarSlot));
	missing.forEach((gap, index) => {
		order.splice(index + 1, 0, gap as BarSlot);
	});
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
