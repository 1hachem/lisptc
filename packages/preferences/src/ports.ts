import type { Awaitable, PromptSource } from "@repo/shared/host";

export type Toggles = Readonly<Record<string, boolean>>;

export interface Preferences {
	font?: string;
	metadata?: Toggles;
	input?: Toggles;
	sidebar?: string[];
	hidden?: string[];
	statusBar?: string[];
	statusBarHidden?: string[];
	motion?: string;
	panelMotion?: boolean;
	traceBesideChat?: boolean;
	traceLink?: boolean;
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
