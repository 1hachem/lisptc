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

export type AnchorLocation =
	| { kind: "shell" }
	| { kind: "sidebar" }
	| { kind: "right" }
	| { kind: "chat" }
	| { kind: "folder"; folder: SidebarFolder }
	| { kind: "page"; page: PageId };

function anchor(doc: string, location: AnchorLocation, opens?: PageId) {
	return { doc, location, ...(opens === undefined ? {} : { opens }) };
}

const SHELL: AnchorLocation = { kind: "shell" };

const SIDEBAR: AnchorLocation = { kind: "sidebar" };

const RIGHT: AnchorLocation = { kind: "right" };

const CHAT: AnchorLocation = { kind: "chat" };

function inFolder(folder: SidebarFolder): AnchorLocation {
	return { kind: "folder", folder };
}

export const anchors = {
	"sidebar/toggle": anchor(
		"left edge of sidebar: click collapses or expands it",
		SHELL,
	),
	workspace: anchor("workspace name, top left: switch workspace", SHELL),
	"workspace/new": anchor("+ beside workspace name: new workspace", SIDEBAR),
	home: anchor("sidebar entry home", SHELL),
	"new-chat": anchor("sidebar entry new_chat: start chat", SHELL),
	chats: anchor("sidebar folder chat: past chats", SHELL),
	"chats/new": anchor("+ on chat folder: new chat", SIDEBAR),
	"chats/search": anchor("search box in chat folder", inFolder("chat")),
	"chats/item": anchor("chat in chat folder, click opens it", inFolder("chat")),
	"chats/menu": anchor(
		"... on chat row, on hover: rename, archive, delete",
		inFolder("chat"),
	),
	"chats/sub-agents": anchor(
		"toggle on chat row: its sub-agent threads",
		inFolder("chat"),
	),
	"chats/more": anchor(
		"more... at end of chat folder: older chats",
		inFolder("chat"),
	),
	"chats/archived": anchor(
		"archived folder inside chat folder",
		inFolder("chat"),
	),
	memories: anchor("sidebar folder memories: what agent remembers", SHELL),
	permissions: anchor("sidebar folder permissions: what agent may call", SHELL),
	knowledge: anchor("sidebar folder knowledge: files user uploaded", SHELL),
	"knowledge/upload": anchor("+ on knowledge folder: upload files", SIDEBAR),
	attachments: anchor("sidebar folder attachments: files sent in chat", SHELL),
	bin: anchor("sidebar folder bin: deleted files", SHELL),
	"sub-agents": anchor("sidebar folder sub-agents", SHELL),
	triggers: anchor("sidebar folder triggers, not ready yet", SIDEBAR),
	tasks: anchor("sidebar folder tasks, not ready yet", SIDEBAR),
	ui: anchor("sidebar folder ui, not ready yet", SIDEBAR),
	tests: anchor("sidebar folder tests, not ready yet", SIDEBAR),
	"files/search": anchor("search box in file folder", inFolder("knowledge")),
	"files/item": anchor(
		"file in file folder, click opens it",
		inFolder("knowledge"),
	),
	"files/menu": anchor(
		"... on file row: rename, move, delete",
		inFolder("knowledge"),
	),
	"files/select": anchor(
		"checkbox on file row: select several",
		inFolder("knowledge"),
	),
	"files/bulk": anchor(
		"bar for selected files: act on all",
		inFolder("knowledge"),
	),
	readme: anchor("sidebar entry README.md", SHELL, "readme"),
	settings: anchor("sidebar entry settings", SHELL, "settings"),
	preferences: anchor("sidebar entry preferences", SHELL, "preferences"),
	account: anchor("gear at bottom of sidebar", SHELL, "account"),
	"sign-out": anchor("sign out, beside user name; click twice", SHELL),
	"right/toggle": anchor(
		"right edge of app: open or close quick preferences",
		SHELL,
	),
	"right/sections": anchor(
		"icons on right edge: quick preference sections",
		SHELL,
	),
	"right/input": anchor("quick preferences: message box helpers", RIGHT),
	"right/status-bar": anchor("quick preferences: what bottom bar shows", RIGHT),
	"right/theme": anchor("quick preferences: theme", RIGHT),
	"right/font": anchor("quick preferences: font", RIGHT),
	"right/motion": anchor("quick preferences: animation", RIGHT),
	"right/metadata": anchor("quick preferences: details under answers", RIGHT),
	"right/developer": anchor("quick preferences: developer switches", RIGHT),
	"right/desktop": anchor("quick preferences: desktop app switches", RIGHT),
	composer: anchor("box where user types message", CHAT),
	"composer/send": anchor("send button in message box", CHAT),
	"composer/stop": anchor("stop button, while agent works", CHAT),
	"composer/queue": anchor(
		"queue button, while agent works and text typed",
		CHAT,
	),
	"composer/attach": anchor("attach files button in message box", CHAT),
	"composer/attachment": anchor("attached file chip, x removes it", CHAT),
	"composer/menu": anchor("menu typing / or @ opens", CHAT),
	"composer/question": anchor(
		"choices in place of message box when you ask",
		CHAT,
	),
	"chat/trace": anchor(
		"button on chat tab: trace of agent steps beside chat",
		CHAT,
	),
	"chat/trace-resize": anchor("handle between chat and trace: drag", CHAT),
	"chat/latest": anchor("jump to newest message, when scrolled up", CHAT),
	"chat/read-more": anchor("read more, on long message", CHAT),
	"chat/attachment": anchor("file attached to message, click opens it", CHAT),
	"chat/message": anchor("agent message, click opens its trace", CHAT),
	"chat/meta": anchor("line under answer: model, cost, trace", CHAT),
	"chat/ask": anchor("card asking user to allow or deny", CHAT),
	"chat/feedback": anchor("feedback buttons under answer", CHAT),
	"chat/todo": anchor("agent todo card, click folds it", CHAT),
	"chat/queued": anchor("queued message, x removes it", CHAT),
	"chat/children": anchor("sub-agent threads under message", CHAT),
	"chat/avatar": anchor("agent avatar, click pokes it", CHAT),
	"panel/tab": anchor("tab at top of panel, click switches", SHELL),
	"panel/tab-close": anchor("x on tab, on hover: closes it", SHELL),
	"panel/split": anchor("pane menu: split, maximize, close pane", SHELL),
	"panel/resize": anchor("handle between panes: drag", SHELL),
	"panel/new-chat": anchor("new chat button on empty workspace", SHELL),
	"status-bar": anchor("bar at bottom of app", SHELL),
	"status/panes": anchor("pane buttons in bottom bar: jump to pane", SHELL),
	"status/zoom": anchor("zoom buttons in bottom bar, desktop app", SHELL),
	"status/desktop": anchor(
		"desktop app status in bottom bar: update, retry",
		SHELL,
	),
};

export type AnchorId = keyof typeof anchors;

export const ANCHOR_IDS = Object.keys(anchors) as AnchorId[];

export function isAnchor(id: string): id is AnchorId {
	return Object.hasOwn(anchors, id);
}

export const ANCHOR_ATTRIBUTE = "data-anchor";

export const CONTENT_ATTRIBUTE = "data-anchor-content";

export type AnchorMark = { readonly [ANCHOR_ATTRIBUTE]: AnchorId };

export function anchorOf(id: AnchorId): AnchorMark {
	return { [ANCHOR_ATTRIBUTE]: id };
}

export const contentRegion = { [CONTENT_ATTRIBUTE]: "" } as const;

export const UNTILS = ["next", "click"] as const;

export const tourStep = z.strictObject({
	anchor: z.enum(ANCHOR_IDS as [AnchorId, ...AnchorId[]]).optional(),
	page: z.enum(PAGE_IDS as [PageId, ...PageId[]]).optional(),
	say: z.string().min(1),
	until: z.enum(UNTILS),
});

export type TourStep = z.infer<typeof tourStep>;

export const MAX_LABEL_CHARS = 40;

const label = z.string().min(1).max(MAX_LABEL_CHARS);

export const tourLabels = z.strictObject({
	next: label.optional(),
	done: label.optional(),
	skip: label.optional(),
});

export type TourLabels = z.infer<typeof tourLabels>;

export const TOUR_LABELS = Object.keys(
	tourLabels.shape,
) as (keyof TourLabels)[];

export const MARKS = ["arrow", "oval"] as const;

export type Mark = (typeof MARKS)[number];

export const MARK_SIZES = ["small", "medium", "large"] as const;

export type MarkSize = (typeof MARK_SIZES)[number];

export const pointer = z.strictObject({
	anchor: z.enum(ANCHOR_IDS as [AnchorId, ...AnchorId[]]),
	mark: z.enum(MARKS),
	size: z.enum(MARK_SIZES),
	click: z.boolean(),
	open: z.enum(PAGE_IDS as [PageId, ...PageId[]]).optional(),
});

export type Pointer = z.infer<typeof pointer>;

export const TOUR_STATUSES = ["active", "paused", "done", "skipped"] as const;

export type TourStatus = (typeof TOUR_STATUSES)[number];
