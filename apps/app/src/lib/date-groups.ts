export const DATE_GROUPS = [
	"today",
	"yesterday",
	"last week",
	"last month",
	"older",
] as const;

export type DateGroup = (typeof DATE_GROUPS)[number];

const DAY_MS = 86_400_000;

function startOfDay(at: number): number {
	const day = new Date(at);
	day.setHours(0, 0, 0, 0);
	return day.getTime();
}

export function dateGroupOf(at: number, now: number): DateGroup {
	const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	if (days <= 7) return "last week";
	if (days <= 30) return "last month";
	return "older";
}

export function byDate<T>(
	items: readonly T[],
	at: (item: T) => number,
	now: number,
): { group: DateGroup; items: T[] }[] {
	const sorted = [...items].sort((a, b) => at(b) - at(a));
	return DATE_GROUPS.map((group) => ({
		group,
		items: sorted.filter((item) => dateGroupOf(at(item), now) === group),
	})).filter(({ items }) => items.length > 0);
}
