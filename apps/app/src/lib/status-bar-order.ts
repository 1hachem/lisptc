import {
	STATUS_BAR_GAPS,
	STATUS_BAR_ITEMS,
	STATUS_BAR_SLOT_COUNT,
	type StatusBarGap,
	type StatusBarItem,
} from "@repo/shared/status-bar";

const LEGACY_GAP = "gap";

export type BarSlot = StatusBarItem | StatusBarGap;

export function isGap(slot: string): slot is StatusBarGap {
	return (STATUS_BAR_GAPS as readonly string[]).includes(slot);
}

export function placeOf(order: readonly BarSlot[], slot: BarSlot): number {
	const index = order.indexOf(slot);
	return index < 0 ? STATUS_BAR_SLOT_COUNT : index + 1;
}

function isItem(name: string): name is StatusBarItem {
	return (STATUS_BAR_ITEMS as readonly string[]).includes(name);
}

function isSlot(name: string): name is BarSlot {
	return isGap(name) || isItem(name);
}

function withGapIds(saved: readonly string[]): string[] {
	const free = STATUS_BAR_GAPS.filter((gap) => !saved.includes(gap));
	return saved.map((name) =>
		name === LEGACY_GAP ? (free.shift() ?? LEGACY_GAP) : name,
	);
}

export function barOrder(saved: readonly string[] | undefined): BarSlot[] {
	const kept: BarSlot[] = [...new Set(withGapIds(saved ?? []))].filter(isSlot);
	const order: BarSlot[] = kept.length === 0 ? [...STATUS_BAR_ITEMS] : kept;
	for (const item of STATUS_BAR_ITEMS) {
		if (!order.includes(item)) order.splice(order.length - 1, 0, item);
	}
	const missing = STATUS_BAR_GAPS.filter((gap) => !order.includes(gap));
	missing.forEach((gap, index) => {
		order.splice(index + 1, 0, gap);
	});
	return order;
}

export function shownItems(
	order: readonly BarSlot[],
	hidden: readonly string[] | undefined,
): StatusBarItem[] {
	const gone = new Set(hidden ?? []);
	return order.filter(
		(slot): slot is StatusBarItem => isItem(slot) && !gone.has(slot),
	);
}

export function toggledItem(
	hidden: readonly string[] | undefined,
	item: StatusBarItem,
): StatusBarItem[] {
	const kept = [...new Set(hidden ?? [])].filter(isItem);
	return kept.includes(item)
		? kept.filter((held) => held !== item)
		: [...kept, item];
}
