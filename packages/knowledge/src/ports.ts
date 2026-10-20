import type { Awaitable, PromptSource } from "@repo/shared/host";

export interface KnowledgeStore {
	files(): Awaitable<string[]>;
	file(name: string): Awaitable<Uint8Array | undefined>;
	write(name: string, text: string, contentType: string): Awaitable<void>;
	remove(name: string): Awaitable<void>;
}

export interface KnowledgeHost {
	store: KnowledgeStore;
	prompt: PromptSource;
}

export interface HeldFile {
	bytes: Uint8Array;
	contentType: string;
}

export class MemoryKnowledgeStore implements KnowledgeStore {
	constructor(public filesHeld: Map<string, HeldFile> = new Map()) {}

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
}
