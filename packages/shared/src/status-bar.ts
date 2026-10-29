export const STATUS_BAR_ITEMS = ["panes", "desktop", "clock"] as const;

export type StatusBarItem = (typeof STATUS_BAR_ITEMS)[number];

export const STATUS_BAR_SLOT_COUNT = 9;

export const STATUS_BAR_GAP_PREFIX = "gap-";

export type StatusBarGap = `${typeof STATUS_BAR_GAP_PREFIX}${number}`;

export const STATUS_BAR_GAPS: readonly StatusBarGap[] = Array.from(
	{ length: STATUS_BAR_SLOT_COUNT - STATUS_BAR_ITEMS.length },
	(_, index): StatusBarGap => `${STATUS_BAR_GAP_PREFIX}${index + 1}`,
);

export const STATUS_BAR_SLOTS: readonly string[] = [
	"panes",
	...STATUS_BAR_GAPS,
	"desktop",
	"clock",
];
