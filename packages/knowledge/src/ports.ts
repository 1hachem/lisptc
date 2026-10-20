import type { Awaitable, PromptSource } from "@repo/shared/host";

export interface KnowledgeStore {
	files(): Awaitable<string[]>;
	file(name: string): Awaitable<Uint8Array | undefined>;
	write(name: string, text: string, contentType: string): Awaitable<void>;
	remove(name: string): Awaitable<void>;
	attachments(): Awaitable<string[]>;
	attachment(name: string): Awaitable<Uint8Array | undefined>;
	attach(
		name: string,
		bytes: Uint8Array,
		contentType: string,
	): Awaitable<string>;
	keep(name: string): Awaitable<void>;
}

export interface Downloaded {
	bytes: Uint8Array;
	contentType: string;
}

export interface Downloader {
	download(url: URL): Promise<Downloaded>;
}

export interface KnowledgeHost {
	store: KnowledgeStore;
	downloader: Downloader;
	prompt: PromptSource;
}

export interface HeldFile {
	bytes: Uint8Array;
	contentType: string;
}

export class MemoryKnowledgeStore implements KnowledgeStore {
	constructor(
		public filesHeld: Map<string, HeldFile> = new Map(),
		public attachmentsHeld: Map<string, HeldFile> = new Map(),
	) {}

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

	attachments(): string[] {
		return [...this.attachmentsHeld.keys()].sort();
	}

	attachment(name: string): Uint8Array | undefined {
		return this.attachmentsHeld.get(name)?.bytes;
	}

	attach(name: string, bytes: Uint8Array, contentType: string): string {
		this.attachmentsHeld.set(name, { bytes, contentType });
		return name;
	}

	keep(name: string): void {
		const attached = this.attachmentsHeld.get(name);
		if (attached === undefined)
			throw new Error(`no file ${name} in attachments`);
		if (this.filesHeld.has(name))
			throw new Error(`knowledge already holds ${name}`);
		this.filesHeld.set(name, attached);
		this.attachmentsHeld.delete(name);
	}
}
