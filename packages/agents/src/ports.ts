import type { Image } from "@repo/interpreter/image";
import type { Awaitable } from "@repo/shared/host";

export interface AgentDefinition {
	readonly name: string;
	readonly prompt: string;
}

export type ReplSeed =
	| { readonly from: "fresh" }
	| { readonly from: "fork"; readonly image: Image };

export interface Spawn {
	readonly definition: AgentDefinition;
	readonly seed: ReplSeed;
}

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
