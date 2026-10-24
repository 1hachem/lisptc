import type { Image } from "@repo/interpreter/image";
import type { Awaitable } from "@repo/shared/host";

export interface AgentDefinition {
	readonly name: string;
	readonly prompt: string;
	readonly permissions?: string;
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

export type Notice =
	| { readonly agent: string; readonly reply: string }
	| { readonly agent: string; readonly failure: string };

export interface Ask {
	readonly message: string;
	readonly maxSteps: number;
	readonly signal: AbortSignal;
}

export interface SubAgent {
	send(ask: Ask): Promise<string>;
}

export interface AgentRunner {
	spawn(spawn: Spawn): SubAgent;
}

export interface AgentDefinitions {
	all(): Awaitable<AgentDefinition[]>;
	get(name: string): Awaitable<AgentDefinition | undefined>;
	put(definition: AgentDefinition): Awaitable<void>;
	delete(name: string): Awaitable<boolean>;
}
