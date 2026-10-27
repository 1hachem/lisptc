import type { Awaitable, PromptSource } from "@repo/shared/host";

export interface Settings {
	name: string;
	model: string;
	icon: string;
	theme: string;
}

export interface ThemeChoice {
	id: string;
	name: string;
	family: string;
	scheme: "light" | "dark";
}

export interface ChatEntry {
	id: string;
	title: string;
	active?: number;
}

export interface ChatPage {
	chats: ChatEntry[];
	more: boolean;
}

export interface ChatQuery {
	search?: string;
	limit: number;
	archived?: boolean;
}

export interface ChatLine {
	role: string;
	text: string;
}

export interface WorkspaceStore {
	settings(): Awaitable<Settings>;
	rename(name: string): Awaitable<void>;
	choose(model: string): Awaitable<void>;
	pickIcon(icon: string): Awaitable<void>;
	pickTheme(theme: string): Awaitable<void>;
	chats(query: ChatQuery): Awaitable<ChatPage>;
	retitle(chatId: string, title: string): Awaitable<void>;
	archive(chatId: string): Awaitable<void>;
	unarchive(chatId: string): Awaitable<void>;
	transcript(chatId: string): Awaitable<ChatLine[]>;
}

export interface WorkspaceHost {
	store: WorkspaceStore;
	models: readonly string[];
	icons: readonly string[];
	themes: readonly ThemeChoice[];
	defaultDarkTheme?: string;
	chatId?: string;
	prompt: PromptSource;
}

export interface HeldChat extends ChatEntry {
	archived?: boolean;
	lines: ChatLine[];
}

export class MemoryWorkspaceStore implements WorkspaceStore {
	constructor(
		public held: Settings,
		public chatsHeld: HeldChat[] = [],
	) {}

	settings(): Settings {
		return this.held;
	}

	rename(name: string): void {
		this.held = { ...this.held, name };
	}

	choose(model: string): void {
		this.held = { ...this.held, model };
	}

	pickIcon(icon: string): void {
		this.held = { ...this.held, icon };
	}

	pickTheme(theme: string): void {
		this.held = { ...this.held, theme };
	}

	chats({ search, limit, archived = false }: ChatQuery): ChatPage {
		const shown = this.chatsHeld.filter(
			(chat) =>
				(chat.archived ?? false) === archived &&
				(search === undefined || chat.title.includes(search)),
		);
		return {
			chats: shown.slice(0, limit).map(({ id, title, active }) => ({
				id,
				title,
				active,
			})),
			more: shown.length > limit,
		};
	}

	retitle(chatId: string, title: string): void {
		this.chat(chatId).title = title;
	}

	archive(chatId: string): void {
		this.chat(chatId).archived = true;
	}

	unarchive(chatId: string): void {
		this.chat(chatId).archived = false;
	}

	transcript(chatId: string): ChatLine[] {
		return this.chat(chatId).lines;
	}

	private chat(chatId: string): HeldChat {
		const found = this.chatsHeld.find((chat) => chat.id === chatId);
		if (found === undefined) throw new Error(`no chat ${chatId}`);
		return found;
	}
}
