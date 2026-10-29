import { z } from "zod";

export const TONES = ["ok", "warn", "bad", "info", "muted"] as const;

export const FOLDERS = ["attachments", "knowledge"] as const;

const actionId = z.string();

const tone = z.enum(TONES, {
	error: `unknown tone; expected one of ${TONES.join(" ")}`,
});

const folder = z.enum(FOLDERS, {
	error: `unknown folder; expected one of ${FOLDERS.join(" ")}`,
});

function widget<const Shape extends z.ZodRawShape>(
	shape: Shape,
	options: {
		children?: boolean;
		actions?: readonly (keyof Shape & string)[];
	} = {},
) {
	return {
		props: z.strictObject(shape),
		children: options.children ?? false,
		actions: options.actions ?? [],
	};
}

export const catalog = {
	text: widget({ text: z.string() }),
	heading: widget({ text: z.string() }),
	markdown: widget({ text: z.string() }),
	link: widget({ text: z.string(), href: z.string() }),
	"file-link": widget({
		text: z.string(),
		folder,
		name: z.string(),
	}),
	badge: widget({ text: z.string(), tone: tone.optional() }),
	kpi: widget({
		label: z.string(),
		value: z.string(),
		hint: z.string().optional(),
	}),
	stack: widget({}, { children: true }),
	row: widget({}, { children: true }),
	card: widget({ title: z.string() }, { children: true }),
	button: widget(
		{ label: z.string(), action: actionId },
		{ actions: ["action"] },
	),
	input: widget({
		name: z.string(),
		label: z.string().optional(),
		placeholder: z.string().optional(),
		value: z.string().optional(),
	}),
	select: widget(
		{
			name: z.string(),
			options: z.array(z.string()),
			label: z.string().optional(),
			value: z.string().optional(),
			"on-change": actionId.optional(),
		},
		{ actions: ["on-change"] },
	),
	checkbox: widget(
		{
			name: z.string(),
			label: z.string().optional(),
			checked: z.boolean().optional(),
			"on-change": actionId.optional(),
		},
		{ actions: ["on-change"] },
	),
	form: widget(
		{ action: actionId, submit: z.string().optional() },
		{ children: true, actions: ["action"] },
	),
	table: widget({
		columns: z.array(z.string()),
		rows: z.array(z.json()),
	}),
};

export type Catalog = typeof catalog;

export type Tag = keyof Catalog;

export type PropsOf<T extends Tag> = z.infer<Catalog[T]["props"]>;

export const TAGS = Object.keys(catalog) as Tag[];

export const ACTION_PROPS: readonly string[] = [
	...new Set(TAGS.flatMap((tag) => catalog[tag].actions)),
];

export function isTag(tag: string): tag is Tag {
	return Object.hasOwn(catalog, tag);
}

export type Widget = { [T in Tag]: { tag: T; props: PropsOf<T> } }[Tag];

export function widgetOf(node: {
	tag: string;
	props: unknown;
}): Widget | undefined {
	if (!isTag(node.tag)) return undefined;
	const parsed = catalog[node.tag].props.safeParse(node.props);
	return parsed.success
		? ({ tag: node.tag, props: parsed.data } as Widget)
		: undefined;
}

function anchor(doc: string) {
	return { doc };
}

export const anchors = {
	composer: anchor("box where user types message"),
	"knowledge/upload": anchor("sidebar button: upload files to knowledge/"),
	settings: anchor("sidebar gear: account settings"),
};

export type AnchorId = keyof typeof anchors;

export const ANCHOR_IDS = Object.keys(anchors) as AnchorId[];

export function isAnchor(id: string): id is AnchorId {
	return Object.hasOwn(anchors, id);
}

function page(title: string, doc: string) {
	return { title, doc };
}

export const pages = {
	account: page(
		"account",
		"user settings: name, email, sign out, delete account",
	),
	settings: page("settings", "workspace settings: name, icon, model"),
	preferences: page(
		"preferences",
		"look and feel: theme, font, what chat shows",
	),
	readme: page("README.md", "workspace readme the agent reads"),
};

export type PageId = keyof typeof pages;

export const PAGE_IDS = Object.keys(pages) as PageId[];

export function isPage(id: string): id is PageId {
	return Object.hasOwn(pages, id);
}

export const UNTILS = ["next", "click"] as const;

export const tourStep = z.strictObject({
	anchor: z.enum(ANCHOR_IDS as [AnchorId, ...AnchorId[]]).optional(),
	page: z.enum(PAGE_IDS as [PageId, ...PageId[]]).optional(),
	say: z.string().min(1),
	until: z.enum(UNTILS),
});

export type TourStep = z.infer<typeof tourStep>;

export const TOUR_STATUSES = ["active", "paused", "done", "skipped"] as const;

export type TourStatus = (typeof TOUR_STATUSES)[number];
