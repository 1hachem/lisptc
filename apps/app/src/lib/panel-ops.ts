import { focusedTab, type PanelOp } from "@repo/shared/panel-layout";
import {
	allTabs,
	openTab,
	paneOf,
	type SplitLayout,
	type Tab,
} from "@repo/shared/split-layout";

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

export interface SideTrace {
	shown: "open" | "collapsed";
	turn?: string;
}

export type PanelContent =
	| { kind: "file"; folder: Folder; name: string }
	| { kind: "source"; folder: string; name: string }
	| { kind: "view"; title: string; viewId: string; chatId?: string }
	| { kind: "chat"; chatId: string | null; title: string; trace?: SideTrace }
	| { kind: "page"; page: Page; id?: string; title: string }
	| { kind: "trace"; chatId: string; title: string; turn?: string };

export type PanelLayout = SplitLayout<PanelContent>;

export const NEW_CHAT: PanelContent = {
	kind: "chat",
	chatId: null,
	title: "new chat",
};

export const STARTING_LAYOUT: PanelLayout = openTab(
	{ root: null, focused: null },
	{ id: "chat:new:start", content: NEW_CHAT },
);

export function shownTabs(layout: PanelLayout): Tab<PanelContent>[] {
	return allTabs(layout).filter(
		(tab) => paneOf(layout, tab.id)?.active === tab.id,
	);
}

export function leadChat(layout: PanelLayout): string | undefined {
	const focused = focusedTab(layout);
	if (focused?.content.kind === "chat") return focused.id;
	return shownTabs(layout).find((t) => t.content.kind === "chat")?.id;
}

function traceTab(chatId: string): string {
	return `trace:${chatId}`;
}

function traceTabFor(chatId: string, turn?: string): Tab<PanelContent> {
	return {
		id: traceTab(chatId),
		content: {
			kind: "trace",
			chatId,
			title: "trace",
			...(turn === undefined ? {} : { turn }),
		},
	};
}

export function traceOpen(
	chatId: string,
	turn?: string,
): PanelOp<PanelContent> {
	const { id, content } = traceTabFor(chatId, turn);
	return { op: "open", tab: id, split: "right", content };
}

export function fileTab(folder: Folder, name: string): string {
	return `file:${folder}/${name}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

type Fields = Record<string, unknown>;

function fileOf(content: Fields): PanelContent | undefined {
	if (content.folder !== "attachments" && content.folder !== "knowledge")
		return undefined;
	if (typeof content.name !== "string") return undefined;
	return { kind: "file", folder: content.folder, name: content.name };
}

export function sourcePanel(folder: string, name: string): PanelContent {
	return { kind: "source", folder, name };
}

function sourceOf(content: Fields): PanelContent | undefined {
	if (typeof content.folder !== "string" || typeof content.name !== "string")
		return undefined;
	return sourcePanel(content.folder, content.name);
}

function viewOf(content: Fields): PanelContent | undefined {
	if (typeof content.title !== "string" || typeof content.viewId !== "string")
		return undefined;
	return {
		kind: "view",
		title: content.title,
		viewId: content.viewId,
		...(typeof content.chatId === "string" ? { chatId: content.chatId } : {}),
	};
}

function sideTraceOf(value: unknown): SideTrace | undefined {
	const trace = record(value);
	if (trace?.shown !== "open" && trace?.shown !== "collapsed") return undefined;
	return {
		shown: trace.shown,
		...(typeof trace.turn === "string" ? { turn: trace.turn } : {}),
	};
}

function chatOf(content: Fields): PanelContent | undefined {
	const { chatId, title } = content;
	if (typeof chatId !== "string" && chatId !== null) return undefined;
	if (typeof title !== "string") return undefined;
	const trace = sideTraceOf(content.trace);
	return {
		kind: "chat",
		chatId,
		title,
		...(trace === undefined ? {} : { trace }),
	};
}

function traceOf(content: Fields): PanelContent | undefined {
	const { chatId, title, turn } = content;
	if (typeof chatId !== "string" || typeof title !== "string") return undefined;
	return {
		kind: "trace",
		chatId,
		title,
		...(typeof turn === "string" ? { turn } : {}),
	};
}

function pageOf(content: Fields): PanelContent | undefined {
	if (!(PAGES as readonly unknown[]).includes(content.page)) return undefined;
	if (typeof content.title !== "string") return undefined;
	return {
		kind: "page",
		page: content.page as Page,
		title: content.title,
		...(typeof content.id === "string" ? { id: content.id } : {}),
	};
}

const CONTENT_OF: Record<
	PanelContent["kind"],
	(content: Fields) => PanelContent | undefined
> = {
	file: fileOf,
	source: sourceOf,
	view: viewOf,
	chat: chatOf,
	page: pageOf,
	trace: traceOf,
};

function contentOf(value: unknown): PanelContent | undefined {
	const content = record(value);
	if (content === undefined || typeof content.kind !== "string")
		return undefined;
	if (!Object.hasOwn(CONTENT_OF, content.kind)) return undefined;
	return CONTENT_OF[content.kind as PanelContent["kind"]](content);
}

export function tabLabel(content: PanelContent): string {
	return content.kind === "file" || content.kind === "source"
		? content.name
		: content.title;
}

export const CHAT_MIN_WIDTH = 360;
export const SIDE_TRACE_MIN_WIDTH = 240;

export function tabMinWidth(content: PanelContent): number {
	if (content.kind !== "chat") return 0;
	return content.trace?.shown === "open"
		? CHAT_MIN_WIDTH + SIDE_TRACE_MIN_WIDTH
		: CHAT_MIN_WIDTH;
}

export const PANEL_DRAG = "application/x-lisptc-panel";

function tabId(content: PanelContent): string {
	switch (content.kind) {
		case "file":
			return fileTab(content.folder, content.name);
		case "source":
			return `source:${content.folder}/${content.name}`;
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
		case "trace":
			return traceTab(content.chatId);
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

export function sideTraceShown(
	trace: SideTrace | undefined,
	besideByDefault: boolean,
): SideTrace {
	return trace ?? { shown: besideByDefault ? "open" : "collapsed" };
}
