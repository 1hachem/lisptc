import type { Image } from "@repo/interpreter/image";
import type { Awaitable } from "@repo/shared/host";

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

export type ChatSeed = { readonly from: "fresh" } | { readonly from: "fork" };

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
	spawn(spawn: Spawn): Promise<string>;
	send(child: string, message: Message): Promise<string>;
	wait(job: string, signal: AbortSignal): Promise<Outcome>;
	state(job: string): Awaitable<Seen>;
	cancel(id: string): Awaitable<boolean>;
}
