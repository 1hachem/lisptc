import {
	allTabs,
	closeTab,
	dropTab,
	focusTab,
	openTab,
	type Placement,
	paneOf,
	replaceTab,
	type SplitLayout,
	type Tab,
	vacantPane,
} from "@repo/components";

export type Folder = "attachments" | "knowledge";

const PAGES = [
	"memory",
	"permission",
	"readme",
	"settings",
	"preferences",
	"account",
	"bin",
] as const;

export type Page = (typeof PAGES)[number];

export type PanelContent =
	| { kind: "file"; folder: Folder; name: string }
	| { kind: "view"; title: string; node: unknown; chatId?: string }
	| { kind: "chat"; chatId: string | null; title: string }
	| { kind: "page"; page: Page; id?: string; title: string };

export type PanelLayout = SplitLayout<PanelContent>;

const RETIRED_MAIN = "main";

export const NEW_CHAT: PanelContent = {
	kind: "chat",
	chatId: null,
	title: "new chat",
};

export const STARTING_LAYOUT: PanelLayout = openTab(
	{ root: null, focused: null },
	{ id: "chat:new:start", content: NEW_CHAT },
);

export function focusedTab(layout: PanelLayout): Tab<PanelContent> | undefined {
	return allTabs(layout).find((tab) => {
		const pane = paneOf(layout, tab.id);
		return pane?.id === layout.focused && pane.active === tab.id;
	});
}

export function shownTabs(layout: PanelLayout): Tab<PanelContent>[] {
	return allTabs(layout).filter(
		(tab) => paneOf(layout, tab.id)?.active === tab.id,
	);
}

export function leadChat(
	layout: PanelLayout,
	minimized: readonly Tab<PanelContent>[] = [],
): string | undefined {
	const focused = focusedTab(layout);
	if (focused?.content.kind === "chat") return focused.id;
	return (
		shownTabs(layout).find((t) => t.content.kind === "chat")?.id ??
		minimized.find((t) => t.content.kind === "chat")?.id
	);
}

function chatTabs(tabs: readonly Tab<PanelContent>[]): Tab<PanelContent>[] {
	return tabs.filter((t) => t.content.kind === "chat");
}

export function lastChatLeaving(
	before: PanelLayout,
	after: PanelLayout,
	minimized: readonly Tab<PanelContent>[],
): Tab<PanelContent> | undefined {
	if (chatTabs(minimized).length > 0) return undefined;
	if (chatTabs(allTabs(after)).length > 0) return undefined;
	return chatTabs(allTabs(before)).at(-1);
}

export function dockTab(
	layout: PanelLayout,
	tab: Tab<PanelContent>,
): PanelLayout {
	if (paneOf(layout, tab.id) !== undefined) return focusTab(layout, tab.id);
	if (layout.root === null) return openTab(layout, tab);
	const vacant = vacantPane(layout);
	if (vacant !== undefined) return dropTab(layout, tab, { pane: vacant });
	return dropTab(layout, tab, { node: layout.root.id, edge: "left" });
}

export function retireMain(layout: PanelLayout): PanelLayout {
	if (paneOf(layout, RETIRED_MAIN) === undefined) return layout;
	return replaceTab(layout, RETIRED_MAIN, panelTab(NEW_CHAT));
}

function placed(
	layout: PanelLayout,
	split: Split,
	content: PanelContent,
): Placement {
	if (split !== "here") return PLACEMENT[split];
	return content.kind !== "chat" && focusedTab(layout)?.content.kind === "chat"
		? "right"
		: "focused";
}

export type Split = "here" | "right" | "down";

export type PanelOp =
	| { op: "open"; tab: string; split: Split; content: PanelContent }
	| { op: "close"; tab: string }
	| { op: "focus"; tab: string };

const PLACEMENT: Record<Split, Placement> = {
	here: "focused",
	right: "right",
	down: "down",
};

export function fileTab(folder: Folder, name: string): string {
	return `file:${folder}/${name}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function contentOf(value: unknown): PanelContent | undefined {
	const content = record(value);
	if (
		content?.kind === "file" &&
		(content.folder === "attachments" || content.folder === "knowledge") &&
		typeof content.name === "string"
	)
		return { kind: "file", folder: content.folder, name: content.name };
	if (content?.kind === "view" && typeof content.title === "string")
		return {
			kind: "view",
			title: content.title,
			node: content.node,
			...(typeof content.chatId === "string" ? { chatId: content.chatId } : {}),
		};
	if (
		content?.kind === "chat" &&
		(typeof content.chatId === "string" || content.chatId === null) &&
		typeof content.title === "string"
	)
		return { kind: "chat", chatId: content.chatId, title: content.title };
	if (
		content?.kind === "page" &&
		(PAGES as readonly unknown[]).includes(content.page) &&
		typeof content.title === "string"
	)
		return {
			kind: "page",
			page: content.page as Page,
			title: content.title,
			...(typeof content.id === "string" ? { id: content.id } : {}),
		};
	return undefined;
}

export function tabLabel(content: PanelContent): string {
	return content.kind === "file" ? content.name : content.title;
}

export const CHAT_MIN_WIDTH = 360;

export function tabMinWidth(content: PanelContent): number {
	return content.kind === "chat" ? CHAT_MIN_WIDTH : 0;
}

export const PANEL_DRAG = "application/x-lisptc-panel";

function tabId(content: PanelContent): string {
	switch (content.kind) {
		case "file":
			return fileTab(content.folder, content.name);
		case "view":
			return `view:${content.title}`;
		case "chat":
			return content.chatId === null
				? `chat:new:${Date.now()}`
				: `chat:${content.chatId}`;
		case "page":
			return content.id === undefined
				? `page:${content.page}`
				: `page:${content.page}/${content.id}`;
	}
}

export function panelTab(content: PanelContent): Tab<PanelContent> {
	return { id: tabId(content), content };
}

export function startPanelDrag(data: DataTransfer, content: PanelContent) {
	data.setData(PANEL_DRAG, JSON.stringify(content));
	data.effectAllowed = "copyMove";
}

export function dragsAs(content: PanelContent) {
	return (event: { dataTransfer: DataTransfer }) =>
		startPanelDrag(event.dataTransfer, content);
}

export function readPanelDrag(
	data: DataTransfer,
): Tab<PanelContent> | undefined {
	try {
		const content = contentOf(JSON.parse(data.getData(PANEL_DRAG)));
		return content === undefined ? undefined : panelTab(content);
	} catch {
		return undefined;
	}
}

export function toPanelOps(value: unknown): PanelOp[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item): PanelOp[] => {
		const op = record(item);
		if (typeof op?.tab !== "string") return [];
		if (op.op === "close" || op.op === "focus")
			return [{ op: op.op, tab: op.tab }];
		const content = contentOf(op.content);
		if (op.op !== "open" || content === undefined) return [];
		const split =
			op.split === "right" || op.split === "down" ? op.split : "here";
		return [{ op: "open", tab: op.tab, split, content }];
	});
}

export function applyPanelOps(
	layout: PanelLayout,
	ops: readonly PanelOp[],
): PanelLayout {
	return ops.reduce((current, op) => {
		if (op.op === "close") return closeTab(current, op.tab);
		if (op.op === "focus") return focusTab(current, op.tab);
		return openTab(
			current,
			{ id: op.tab, content: op.content },
			placed(current, op.split, op.content),
		);
	}, layout);
}
