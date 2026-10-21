import {
	closeTab,
	dropTab,
	focusTab,
	openTab,
	type Placement,
	paneOf,
	type SplitLayout,
	type Tab,
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
	| { kind: "main" }
	| { kind: "file"; folder: Folder; name: string }
	| { kind: "view"; title: string; node: unknown }
	| { kind: "chat"; chatId: string | null; title: string }
	| { kind: "page"; page: Page; id?: string; title: string };

export type PanelLayout = SplitLayout<PanelContent>;

const MAIN_TAB: Tab<PanelContent> = {
	id: "main",
	content: { kind: "main" },
};

export function chatDocked(layout: PanelLayout): boolean {
	return paneOf(layout, MAIN_TAB.id) !== undefined;
}

export function withMain(layout: PanelLayout): PanelLayout {
	if (paneOf(layout, MAIN_TAB.id) !== undefined) return layout;
	if (layout.root === null) return openTab(layout, MAIN_TAB);
	return dropTab(layout, MAIN_TAB, { node: layout.root.id, edge: "left" });
}

function placed(layout: PanelLayout, split: Split): Placement {
	if (split !== "here") return PLACEMENT[split];
	const focused = paneOf(layout, MAIN_TAB.id);
	return focused !== undefined && focused.id === layout.focused
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
		return { kind: "view", title: content.title, node: content.node };
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
	if (content.kind === "main") return "chat";
	return content.kind === "file" ? content.name : content.title;
}

export const PANEL_DRAG = "application/x-lisptc-panel";

function tabId(content: PanelContent): string {
	switch (content.kind) {
		case "main":
			return MAIN_TAB.id;
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
			placed(current, op.split),
		);
	}, layout);
}
