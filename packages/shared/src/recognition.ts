import type { Awaitable } from "./host.ts";

export interface Turn {
	readonly role: string;
	readonly content: string;
}

export interface Situation {
	readonly conversation: readonly Turn[];
}

export interface Cue {
	readonly key: string;
	readonly situation: string;
	readonly unless?: string;
	readonly gist: string;
	readonly area?: string;
}

export interface AreaGate {
	readonly name: string;
	readonly situation: string;
}

export interface Area extends AreaGate {
	readonly open: boolean;
}

export type Recognize = (
	situation: Situation,
	cues: readonly Cue[],
	areas?: readonly Area[],
) => Awaitable<ReadonlyMap<string, number>>;
