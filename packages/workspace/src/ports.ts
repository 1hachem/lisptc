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
	file(name: string): Awaitable<Uint8Array | undefined>;
	write(name: string, text: string, contentType: string): Awaitable<void>;
	remove(name: string): Awaitable<void>;
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

export interface HeldFile {
	bytes: Uint8Array;
	contentType: string;
}

export class MemoryWorkspaceStore implements WorkspaceStore {
	constructor(
		public held: Settings,
		public chatsHeld: HeldChat[] = [],
		public filesHeld: Map<string, HeldFile> = new Map(),
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

	file(name: string): Uint8Array | undefined {
		return this.filesHeld.get(name)?.bytes;
	}

	write(name: string, text: string, contentType: string): void {
		this.filesHeld.set(name, {
			bytes: new TextEncoder().encode(text),
			contentType,
		});
	}

	remove(name: string): void {
		if (!this.filesHeld.delete(name)) throw new Error(`no file ${name}`);
	}

	private chat(chatId: string): HeldChat {
		const found = this.chatsHeld.find((chat) => chat.id === chatId);
		if (found === undefined) throw new Error(`no chat ${chatId}`);
		return found;
	}
}
