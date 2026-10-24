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

export interface Notice {
	readonly source: string;
	readonly text: string;
}

export interface Ask {
	readonly message: string;
	readonly maxSteps: number;
	readonly signal: AbortSignal;
}

export interface AgentRunner {
	spawn(spawn: Spawn): Promise<string>;
	send(agent: string, ask: Ask): Promise<string>;
}

export interface Code {
	readonly source: string;
	readonly image: Image;
}

export interface CodeRunner {
	run(code: Code, signal: AbortSignal): Promise<string>;
}

export type Work =
	| {
			readonly kind: "agent";
			readonly agent: string;
			readonly name: string;
			readonly message: string;
			readonly maxSteps: number;
	  }
	| { readonly kind: "code"; readonly source: string; readonly image: Image };

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

export type Outcome = { readonly reply: string } | { readonly failure: string };

export interface Seen {
	readonly state: JobState;
	readonly outcome?: Outcome;
}

export interface Jobs {
	spawn(spawn: Spawn): Promise<string>;
	submit(work: Work): Awaitable<string>;
	peek(job: string): Awaitable<Seen | undefined>;
	wait(job: string, signal: AbortSignal): Promise<Outcome>;
	cancel(job: string): Awaitable<boolean>;
}

export interface AgentDefinitions {
	all(): Awaitable<AgentDefinition[]>;
	get(name: string): Awaitable<AgentDefinition | undefined>;
	put(definition: AgentDefinition): Awaitable<void>;
	delete(name: string): Awaitable<boolean>;
}
