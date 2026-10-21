import type { Awaitable, PromptSource } from "@repo/shared/host";

export type StoreFolder = "attachments" | "knowledge";

export interface BinnedFile {
	name: string;
	from: StoreFolder;
}

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
	unattach(name: string): Awaitable<void>;
	binned(): Awaitable<BinnedFile[]>;
	restore(name: string): Awaitable<BinnedFile>;
	erase(name: string): Awaitable<void>;
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
		public binHeld: Map<string, HeldFile & { from: StoreFolder }> = new Map(),
	) {}

	private held(folder: StoreFolder): Map<string, HeldFile> {
		return folder === "knowledge" ? this.filesHeld : this.attachmentsHeld;
	}

	private toBin(folder: StoreFolder, name: string): void {
		const file = this.held(folder).get(name);
		if (file === undefined) throw new Error(`no file ${name} in ${folder}`);
		this.binHeld.set(name, { ...file, from: folder });
		this.held(folder).delete(name);
	}

	files(): string[] {
		return [...this.filesHeld.keys()].sort();
	}

	file(name: string): Uint8Array | undefined {
		return this.filesHeld.get(name)?.bytes;
	}

	write(name: string, text: string, contentType: string): void {
		if (this.filesHeld.has(name)) this.toBin("knowledge", name);
		this.filesHeld.set(name, {
			bytes: new TextEncoder().encode(text),
			contentType,
		});
	}

	remove(name: string): void {
		if (!this.filesHeld.has(name)) throw new Error(`no file ${name}`);
		this.toBin("knowledge", name);
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

	unattach(name: string): void {
		this.toBin("attachments", name);
	}

	binned(): BinnedFile[] {
		return [...this.binHeld].map(([name, { from }]) => ({ name, from }));
	}

	restore(name: string): BinnedFile {
		const binned = this.binHeld.get(name);
		if (binned === undefined) throw new Error(`no file ${name} in the bin`);
		const { from, ...file } = binned;
		if (this.held(from).has(name))
			throw new Error(`${from} already holds ${name}`);
		this.held(from).set(name, file);
		this.binHeld.delete(name);
		return { name, from };
	}

	erase(name: string): void {
		if (!this.binHeld.delete(name))
			throw new Error(`no file ${name} in the bin`);
	}
}
