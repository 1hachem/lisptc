import type { Image } from "@repo/interpreter/image";
import type { Awaitable } from "@repo/shared/host";

export interface JobSpec {
	readonly parent: string;
	readonly code: string;
	readonly fork: Image | null;
	readonly permissions: string | null;
	readonly deadlineSeconds: number | null;
}

export type JobState =
	| "pending"
	| "held"
	| "done"
	| "failed"
	| "cancelled"
	| "lost";

export type Outcome = { readonly value: string } | { readonly failure: string };

export interface Seen {
	readonly state: JobState;
	readonly outcome?: Outcome;
}

export interface BackgroundJobs {
	start(spec: JobSpec): Promise<string>;
	state(job: string): Awaitable<Seen>;
	wait(job: string, signal: AbortSignal): Promise<Outcome>;
	cancel(job: string): Awaitable<boolean>;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface Clock {
	now(): number;
	random(): number;
}
