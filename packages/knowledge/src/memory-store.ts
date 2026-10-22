import { fittedFileName, type StoreFolder } from "@repo/shared/files";
import type { BinnedFile, KnowledgeStore } from "./ports.ts";

export interface HeldFile {
	bytes: Uint8Array;
	contentType: string;
}

export interface BinHeld extends HeldFile {
	from: StoreFolder;
	binnedAt: number;
}

const REPLACES_ON_WRITE: Record<StoreFolder, boolean> = {
	attachments: false,
	knowledge: true,
};

const MAX_RENAMES = 100;

function freeIn(held: ReadonlyMap<string, unknown>, name: string): string {
	if (!held.has(name)) return name;
	for (let n = 2; n <= MAX_RENAMES; n++) {
		const candidate = fittedFileName(name, ` (${n})`);
		if (!held.has(candidate)) return candidate;
	}
	throw new Error(`every numbered name for ${name} is taken`);
}

export class MemoryKnowledgeStore implements KnowledgeStore {
	private binnings = 0;

	constructor(
		public held: Record<StoreFolder, Map<string, HeldFile>> = {
			attachments: new Map(),
			knowledge: new Map(),
		},
		public binHeld: Map<string, BinHeld> = new Map(),
	) {}

	private toBin(folder: StoreFolder, name: string): void {
		const file = this.held[folder].get(name);
		if (file === undefined) throw new Error(`no file ${name} in ${folder}`);
		this.binHeld.set(freeIn(this.binHeld, name), {
			...file,
			from: folder,
			binnedAt: this.binnings++,
		});
		this.held[folder].delete(name);
	}

	names(folder: StoreFolder): string[] {
		return [...this.held[folder].keys()].sort();
	}

	read(folder: StoreFolder, name: string): Uint8Array | undefined {
		return this.held[folder].get(name)?.bytes;
	}

	write(
		folder: StoreFolder,
		name: string,
		bytes: Uint8Array,
		contentType: string,
	): string {
		const replacing = REPLACES_ON_WRITE[folder] && this.held[folder].has(name);
		if (replacing) this.toBin(folder, name);
		const stored = replacing ? name : freeIn(this.held[folder], name);
		this.held[folder].set(stored, { bytes, contentType });
		return stored;
	}

	remove(folder: StoreFolder, name: string): void {
		this.toBin(folder, name);
	}

	keep(name: string): void {
		const attached = this.held.attachments.get(name);
		if (attached === undefined)
			throw new Error(`no file ${name} in attachments`);
		if (this.held.knowledge.has(name))
			throw new Error(`knowledge already holds ${name}`);
		this.held.knowledge.set(name, attached);
		this.held.attachments.delete(name);
	}

	binned(): BinnedFile[] {
		return [...this.binHeld]
			.sort(([, a], [, b]) => b.binnedAt - a.binnedAt)
			.map(([name, { from }]) => ({ name, from }));
	}

	restore(name: string): BinnedFile {
		const binned = this.binHeld.get(name);
		if (binned === undefined) throw new Error(`no file ${name} in the bin`);
		const { from, binnedAt: _, ...file } = binned;
		const restored = freeIn(this.held[from], name);
		this.held[from].set(restored, file);
		this.binHeld.delete(name);
		return { name: restored, from };
	}

	erase(name: string): void {
		if (!this.binHeld.delete(name))
			throw new Error(`no file ${name} in the bin`);
	}
}
