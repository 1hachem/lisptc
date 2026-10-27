import type { StoreFolder } from "@repo/shared/files";
import type { Awaitable, Clock, PromptSource } from "@repo/shared/host";

export interface BinnedFile {
	name: string;
	from: StoreFolder;
}

export interface KnowledgeStore {
	names(folder: StoreFolder): Awaitable<string[]>;
	read(folder: StoreFolder, name: string): Awaitable<Uint8Array | undefined>;
	write(
		folder: StoreFolder,
		name: string,
		bytes: Uint8Array,
		contentType: string,
	): Awaitable<string>;
	remove(folder: StoreFolder, name: string): Awaitable<void>;
	keep(name: string): Awaitable<void>;
	unkeep(name: string): Awaitable<void>;
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

export interface PdfReader {
	text(bytes: Uint8Array): Awaitable<string>;
}

export interface KnowledgeHost {
	store: KnowledgeStore;
	downloader: Downloader;
	pdf: PdfReader;
	prompt: PromptSource;
	clock: Clock;
}
