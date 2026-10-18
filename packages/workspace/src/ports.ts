import type { Awaitable, PromptSource } from "@repo/shared/host";

export interface Settings {
	name: string;
	model: string;
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

export interface ChatLine {
	role: string;
	text: string;
}

export interface WorkspaceStore {
	settings(): Awaitable<Settings>;
	rename(name: string): Awaitable<void>;
	choose(model: string): Awaitable<void>;
	chats(query: { search?: string; limit: number }): Awaitable<ChatPage>;
	retitle(chatId: string, title: string): Awaitable<void>;
	archive(chatId: string): Awaitable<void>;
	transcript(chatId: string): Awaitable<ChatLine[]>;
	files(): Awaitable<string[]>;
	file(path: string): Awaitable<string | undefined>;
	write(path: string, source: string): Awaitable<void>;
	remove(path: string): Awaitable<void>;
}

export const MAX_FILE_PATH = 128;
const FILE_PATH = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*\.ptc$/;

export function isFilePath(path: string): boolean {
	return path.length <= MAX_FILE_PATH && FILE_PATH.test(path);
}

export interface WorkspaceHost {
	store: WorkspaceStore;
	models: readonly string[];
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
		public filesHeld: Map<string, string> = new Map(),
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

	chats({ search, limit }: { search?: string; limit: number }): ChatPage {
		const live = this.chatsHeld.filter(
			(chat) =>
				!chat.archived && (search === undefined || chat.title.includes(search)),
		);
		return {
			chats: live.slice(0, limit).map(({ id, title, active }) => ({
				id,
				title,
				active,
			})),
			more: live.length > limit,
		};
	}

	retitle(chatId: string, title: string): void {
		this.chat(chatId).title = title;
	}

	archive(chatId: string): void {
		this.chat(chatId).archived = true;
	}

	transcript(chatId: string): ChatLine[] {
		return this.chat(chatId).lines;
	}

	files(): string[] {
		return [...this.filesHeld.keys()].sort();
	}

	file(path: string): string | undefined {
		return this.filesHeld.get(path);
	}

	write(path: string, source: string): void {
		this.filesHeld.set(path, source);
	}

	remove(path: string): void {
		if (!this.filesHeld.delete(path)) throw new Error(`no file ${path}`);
	}

	private chat(chatId: string): HeldChat {
		const found = this.chatsHeld.find((chat) => chat.id === chatId);
		if (found === undefined) throw new Error(`no chat ${chatId}`);
		return found;
	}
}
