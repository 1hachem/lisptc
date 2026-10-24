import { FINISHED } from "./job-table.ts";
import type {
	AgentRunner,
	CodeRunner,
	JobState,
	Jobs,
	Notice,
	Outcome,
	Seen,
	Spawn,
	Work,
} from "./ports.ts";

interface Entry {
	state: JobState;
	outcome?: Outcome;
	claimed: boolean;
	readonly source: string;
	readonly stop: AbortController;
	settled: Promise<Outcome>;
}

export interface Runners {
	readonly agents?: AgentRunner;
	readonly code?: CodeRunner;
}

function failureOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function textOf(outcome: Outcome): string {
	return "reply" in outcome ? outcome.reply : `failed: ${outcome.failure}`;
}

export class MemoryJobs implements Jobs {
	private readonly queues = new Map<string, Promise<unknown>>();
	private readonly jobs = new Map<string, Entry>();

	constructor(
		private readonly runners: Runners,
		private readonly notify: (notice: Notice) => void = () => {},
		private readonly newId: () => string = () => crypto.randomUUID(),
	) {}

	spawn(spawn: Spawn): Promise<string> {
		return this.agents().spawn(spawn);
	}

	submit(work: Work): string {
		const id = this.newId();
		const stop = new AbortController();
		const entry: Entry = {
			state: "queued",
			claimed: false,
			source: work.kind === "agent" ? `agent:${work.name}` : `job:${id}`,
			stop,
			settled: Promise.resolve({ failure: "never ran" }),
		};
		const run = async (): Promise<Outcome> => {
			if (stop.signal.aborted) return { failure: "cancelled" };
			entry.state = "running";
			try {
				return { reply: await this.perform(work, stop.signal) };
			} catch (error) {
				return { failure: failureOf(error) };
			}
		};
		const lane = work.kind === "agent" ? work.agent : id;
		entry.settled = (this.queues.get(lane) ?? Promise.resolve()).then(run);
		this.queues.set(lane, entry.settled);
		this.jobs.set(id, entry);
		void entry.settled.then((outcome) => this.settle(entry, outcome));
		return id;
	}

	peek(job: string): Seen | undefined {
		const entry = this.jobs.get(job);
		if (entry === undefined) return undefined;
		return entry.outcome === undefined
			? { state: entry.state }
			: { state: entry.state, outcome: entry.outcome };
	}

	wait(job: string, signal: AbortSignal): Promise<Outcome> {
		const entry = this.entry(job);
		entry.claimed = true;
		return new Promise((resolve, reject) => {
			const giveUp = () => {
				entry.claimed = false;
				reject(signal.reason);
			};
			if (signal.aborted) return giveUp();
			signal.addEventListener("abort", giveUp, { once: true });
			void entry.settled.then((outcome) => {
				signal.removeEventListener("abort", giveUp);
				resolve(outcome);
			});
		});
	}

	cancel(job: string): boolean {
		const entry = this.entry(job);
		if (FINISHED.has(entry.state)) return false;
		entry.state = "cancelled";
		entry.stop.abort(new Error("cancelled"));
		return true;
	}

	private perform(work: Work, signal: AbortSignal): Promise<string> {
		if (work.kind === "agent")
			return this.agents().send(work.agent, {
				message: work.message,
				maxSteps: work.maxSteps,
				signal,
			});
		if (this.runners.code === undefined)
			throw new Error("this host runs no background code");
		return this.runners.code.run(
			{ source: work.source, image: work.image },
			signal,
		);
	}

	private settle(entry: Entry, outcome: Outcome): void {
		if (entry.state !== "cancelled")
			entry.state = "reply" in outcome ? "done" : "failed";
		entry.outcome =
			entry.state === "cancelled" ? { failure: "cancelled" } : outcome;
		if (!entry.claimed && entry.state !== "cancelled")
			this.notify({ source: entry.source, text: textOf(outcome) });
	}

	private agents(): AgentRunner {
		if (this.runners.agents === undefined)
			throw new Error("this host runs no sub-agents");
		return this.runners.agents;
	}

	private entry(job: string): Entry {
		const entry = this.jobs.get(job);
		if (entry === undefined) throw new Error(`no job ${job}`);
		return entry;
	}
}
