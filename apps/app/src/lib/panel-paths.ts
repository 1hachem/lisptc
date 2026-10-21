import {
	type Folder,
	NEW_CHAT,
	type Page,
	type PanelContent,
} from "./panel-ops.ts";

const FOLDERS: readonly Folder[] = ["knowledge", "attachments"];

const KEYED = {
	memory: "memories",
	permission: "permissions",
	bin: "bin",
} as const satisfies Partial<Record<Page, string>>;

type KeyedPage = keyof typeof KEYED;

const NAMED = {
	readme: "README.md",
	settings: "settings.ptc",
	preferences: "preferences.ptc",
	account: "account",
} as const satisfies Record<Exclude<Page, KeyedPage>, string>;

type NamedPage = keyof typeof NAMED;

function keyed(page: Page): page is KeyedPage {
	return page in KEYED;
}

export function panelPath(content: PanelContent): string | undefined {
	switch (content.kind) {
		case "view":
			return undefined;
		case "chat":
			return content.chatId === null ? "" : `chat/${content.chatId}`;
		case "file":
			return `${content.folder}/${content.name}`;
		case "page":
			return keyed(content.page)
				? `${KEYED[content.page]}/${content.id ?? ""}`
				: content.page;
	}
}

function pageTitle(page: KeyedPage, id: string): string {
	return `${KEYED[page]}/${id}`;
}

export function panelAt(path: string): PanelContent | undefined {
	const trimmed = path.replace(/^\/+|\/+$/g, "");
	if (trimmed === "") return NEW_CHAT;
	const slash = trimmed.indexOf("/");
	const head = slash === -1 ? trimmed : trimmed.slice(0, slash);
	const rest = slash === -1 ? "" : trimmed.slice(slash + 1);
	if (head in NAMED && rest === "")
		return {
			kind: "page",
			page: head as NamedPage,
			title: NAMED[head as NamedPage],
		};
	if (rest === "") return undefined;
	if (head === "chat") return { kind: "chat", chatId: rest, title: "chat" };
	const folder = FOLDERS.find((f) => f === head);
	if (folder !== undefined) return { kind: "file", folder, name: rest };
	const page = (Object.keys(KEYED) as KeyedPage[]).find(
		(p) => KEYED[p] === head,
	);
	if (page === undefined) return undefined;
	return { kind: "page", page, id: rest, title: pageTitle(page, rest) };
}
