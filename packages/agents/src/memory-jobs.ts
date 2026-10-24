import type {
	AgentJobs,
	AgentRunner,
	Job,
	JobState,
	Notice,
	Outcome,
	Spawn,
	SubAgent,
} from "./ports.ts";

interface Spawned {
	readonly name: string;
	readonly agent: SubAgent;
	queue: Promise<unknown>;
}

interface Entry {
	state: JobState;
	claimed: boolean;
	readonly stop: AbortController;
	readonly settled: Promise<Outcome>;
}

const FINISHED: ReadonlySet<JobState> = new Set([
	"done",
	"failed",
	"cancelled",
]);

function failureOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function noticeOf(name: string, outcome: Outcome): Notice {
	return {
		source: `agent:${name}`,
		text: "reply" in outcome ? outcome.reply : `failed: ${outcome.failure}`,
	};
}

export class MemoryAgentJobs implements AgentJobs {
	private readonly spawned = new Map<string, Spawned>();
	private readonly jobs = new Map<string, Entry>();

	constructor(
		private readonly runner: AgentRunner,
		private readonly notify: (notice: Notice) => void = () => {},
		private readonly newId: () => string = () => crypto.randomUUID(),
	) {}

	spawn(spawn: Spawn): string {
		const id = this.newId();
		this.spawned.set(id, {
			name: spawn.definition.name,
			agent: this.runner.spawn(spawn),
			queue: Promise.resolve(),
		});
		return id;
	}

	send(agent: string, { message, maxSteps }: Job): string {
		const target = this.spawned.get(agent);
		if (target === undefined) throw new Error(`no spawned agent ${agent}`);
		const id = this.newId();
		const stop = new AbortController();
		const run = async (): Promise<Outcome> => {
			if (stop.signal.aborted) return { failure: "cancelled" };
			entry.state = "running";
			try {
				return {
					reply: await target.agent.send({
						message,
						maxSteps,
						signal: stop.signal,
					}),
				};
			} catch (error) {
				return { failure: failureOf(error) };
			}
		};
		const settled = target.queue.then(run);
		const entry: Entry = { state: "queued", claimed: false, stop, settled };
		target.queue = settled;
		this.jobs.set(id, entry);
		void settled.then((outcome) => {
			if (entry.state !== "cancelled")
				entry.state = "reply" in outcome ? "done" : "failed";
			if (!entry.claimed && entry.state !== "cancelled")
				this.notify(noticeOf(target.name, outcome));
		});
		return id;
	}

	state(job: string): JobState {
		return this.entry(job).state;
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

	private entry(job: string): Entry {
		const entry = this.jobs.get(job);
		if (entry === undefined) throw new Error(`no agent job ${job}`);
		return entry;
	}
}
