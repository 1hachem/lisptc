import type { Fragment, Image } from "@repo/interpreter/image";
import type { ConversationEntry } from "@repo/interpreter/session";
import type { Awaitable } from "@repo/shared/host";

export const PARENT_NAME = "parent";

export interface AgentDefinition {
	readonly name: string;
	readonly prompt: string;
	readonly permissions?: string;
	readonly roster?: readonly string[];
	readonly budget?: number;
}

export type ReplSeed =
	| { readonly from: "fresh" }
	| { readonly from: "fork"; readonly image: Image };

export type ChatSeed =
	| { readonly from: "fresh" }
	| { readonly from: "fork"; readonly entries: readonly ConversationEntry[] };

export interface Spawn {
	readonly definition: AgentDefinition;
	readonly seed: ReplSeed;
	readonly chat: ChatSeed;
}

export interface Message {
	readonly text: string;
	readonly maxSteps: number;
}

export type JobState =
	| "idle"
	| "pending"
	| "held"
	| "done"
	| "failed"
	| "cancelled"
	| "lost";

export type Outcome = { readonly reply: string } | { readonly failure: string };

export interface Seen {
	readonly state: JobState;
	readonly outcome?: Outcome;
}

export interface AgentThreads {
	spawn(spawn: Spawn): Promise<void>;
	send(agent: string, message: Message): Promise<void>;
	wait(agent: string, signal: AbortSignal): Promise<Outcome>;
	state(agent: string): Awaitable<Seen>;
	cancel(agent: string): Awaitable<boolean>;
	read(agent: string, global: string): Promise<Fragment>;
}
