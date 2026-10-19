import type { Awaitable, PromptSource } from "@repo/shared/host";

export type Toggles = Readonly<Record<string, boolean>>;

export interface Preferences {
	theme?: string;
	font?: string;
	channels?: Toggles;
	metadata?: Toggles;
	input?: Toggles;
	sidebar?: string[];
	hidden?: string[];
	motion?: string;
}

export interface PreferencesStore {
	read(): Awaitable<Preferences>;
	write(change: Preferences): Awaitable<void>;
}

export interface Choice {
	id: string;
	name: string;
}

export interface PreferencesHost {
	store: PreferencesStore;
	themes: readonly Choice[];
	fonts: readonly Choice[];
	motions: readonly Choice[];
	prompt: PromptSource;
}

export class MemoryPreferencesStore implements PreferencesStore {
	constructor(private held: Preferences = {}) {}

	read(): Preferences {
		return this.held;
	}

	write(change: Preferences): void {
		this.held = { ...this.held, ...change };
	}
}
