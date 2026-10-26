import type { StepAnnotations } from "@repo/interpreter/session";
import type { AgentRepl } from "@repo/repl/repl";
import type { Awaitable } from "@repo/shared/host";
import { envelopeOf } from "@repo/shared/messages";
import { Budget, type Limits } from "./budget.ts";
import type { Envelope } from "./mailbox.ts";
import type { TurnOutcome, WireMessage } from "./stream.ts";
import { type PostOptions, Thread, type ThreadPorts } from "./thread.ts";
import { type UiActionResult, uiActionOn } from "./ui-action.ts";

export interface Lineage {
	readonly parent?: string;
	readonly title?: string;
	readonly limits?: Limits;
}

export interface ThreadsHost {
	readonly ports: Omit<ThreadPorts, "repl" | "budget">;
	repl(threadId: string): Awaitable<AgentRepl>;
	lineage(threadId: string): Awaitable<Lineage>;
}

export interface ThreadsOptions {
	readonly maxLive?: number;
	readonly maxDepth?: number;
}

export interface AskOptions extends PostOptions {
	readonly replyTo?: string;
}

export type JobState =
	| "pending"
	| "held"
	| "done"
	| "failed"
	| "cancelled"
	| "lost";

export type ThreadRunState = "busy" | "idle" | "lost";

export type Seen =
	| { readonly job: string; readonly state: JobState; outcome?: TurnOutcome }
	| { readonly thread: string; readonly state: ThreadRunState };

interface Live {
	readonly thread: Thread;
	repl?: Promise<AgentRepl>;
}

interface Job {
	readonly thread: string;
	envelope: string;
	readonly replyTo?: string;
	state: JobState;
	outcome?: TurnOutcome;
	waiter?: (outcome: TurnOutcome) => void;
}

const LOST: TurnOutcome = { stopped: "lost in a restart" };

const CANCELLED: TurnOutcome = { stopped: "cancelled" };

const OUTSIDE: UiActionResult = {
	output: "that ask belongs to no thread under this one",
	error: true,
};

const MAX_LIVE = 50;

class SpawnTooDeep extends Error {
	constructor(readonly parent: string) {
		super(`thread ${parent} is too deep to spawn another`);
	}
}

function replyText(outcome: TurnOutcome): string | undefined {
	if ("answer" in outcome) return outcome.answer;
	if ("stopped" in outcome) return `failed: ${outcome.stopped}`;
	return undefined;
}

export class Threads {
	readonly budget = new Budget();
	private readonly live = new Map<string, Live>();
	private readonly lineages = new Map<string, Promise<Lineage>>();
	private readonly parents = new Map<string, string | undefined>();
	private readonly jobs = new Map<string, Job>();
	private readonly returns = new Map<string, string>();
	private readonly asking = new Map<string, string>();
	private readonly maxLive: number;
	private readonly maxDepth: number;

	constructor(
		private readonly host: ThreadsHost,
		{
			maxLive = MAX_LIVE,
			maxDepth = Number.POSITIVE_INFINITY,
		}: ThreadsOptions = {},
	) {
		this.maxLive = maxLive;
		this.maxDepth = maxDepth;
	}

	get(threadId: string): Thread {
		const standing = this.live.get(threadId);
		if (standing !== undefined) {
			this.live.delete(threadId);
			this.live.set(threadId, standing);
			return standing.thread;
		}
		const thread = new Thread(threadId, {
			...this.host.ports,
			repl: () => this.repl(threadId),
			budget: {
				remaining: async () => {
					await this.lineage(threadId);
					return this.budget.remaining(threadId);
				},
				charge: (usage) => this.budget.charge(threadId, usage),
			},
		});
		this.live.set(threadId, { thread });
		this.evict(threadId);
		return thread;
	}

	watch(threadId: string, signal?: AbortSignal): Response {
		return this.get(threadId).watch(signal);
	}

	repl(threadId: string): Promise<AgentRepl> {
		this.get(threadId);
		const live = this.live.get(threadId);
		if (live === undefined) throw new Error(`thread ${threadId} was evicted`);
		live.repl ??= Promise.resolve(this.host.repl(threadId)).catch(
			(error: unknown) => {
				live.repl = undefined;
				throw error;
			},
		);
		return live.repl;
	}

	lineage(threadId: string): Promise<Lineage> {
		const known = this.lineages.get(threadId);
		if (known !== undefined) return known;
		const loading = Promise.resolve(this.host.lineage(threadId)).then(
			async (lineage) => {
				if (lineage.parent !== undefined) await this.lineage(lineage.parent);
				this.parents.set(threadId, lineage.parent);
				if (!this.budget.has(threadId))
					this.budget.open(threadId, lineage.parent, lineage.limits);
				return lineage;
			},
		);
		loading.catch(() => this.lineages.delete(threadId));
		this.lineages.set(threadId, loading);
		return loading;
	}

	async ancestors(threadId: string): Promise<string[]> {
		await this.lineage(threadId);
		const above: string[] = [];
		for (let at = this.parents.get(threadId); at !== undefined; ) {
			if (above.includes(at)) break;
			above.push(at);
			at = this.parents.get(at);
		}
		return above;
	}

	async root(threadId: string): Promise<string> {
		return (await this.ancestors(threadId)).at(-1) ?? threadId;
	}

	async spawn(
		parent: string,
		create: () => Promise<string>,
		limits?: Limits,
	): Promise<string> {
		if ((await this.ancestors(parent)).length >= this.maxDepth)
			throw new SpawnTooDeep(parent);
		const child = await create();
		this.parents.set(child, parent);
		this.budget.open(child, parent, limits);
		this.lineages.set(child, Promise.resolve({ parent, limits }));
		return child;
	}

	async ask(
		to: string,
		envelope: Envelope,
		{ replyTo, ...options }: AskOptions = {},
	): Promise<string> {
		const id = crypto.randomUUID();
		const job: Job = {
			thread: to,
			envelope: envelope.id,
			state: "pending",
			...(replyTo === undefined ? {} : { replyTo }),
		};
		this.jobs.set(id, job);
		if (replyTo !== undefined) this.returns.set(to, replyTo);
		options.signal?.addEventListener(
			"abort",
			() => {
				void this.cancel(id);
			},
			{ once: true },
		);
		await this.run(id, job, envelope, options);
		return id;
	}

	async answer(
		root: string,
		action: string,
		values: Record<string, unknown>,
		ask?: string,
	): Promise<UiActionResult> {
		const target = ask === undefined ? root : await this.asker(root, ask);
		if (target === undefined) return OUTSIDE;
		const result = await uiActionOn(await this.repl(target), action, values);
		if (result.message !== undefined && !result.error)
			await this.followUp(target, {
				kind: "event",
				id: crypto.randomUUID(),
				source: action,
				text: result.message,
			});
		return result;
	}

	private async asker(root: string, ask: string): Promise<string | undefined> {
		const asked = (await this.host.ports.transcript.read(root)).find(
			(message) => message.id === ask,
		);
		const stamped = envelopeOf(asked?.additional_kwargs).thread;
		if (stamped === undefined || stamped === root) return root;
		return (await this.ancestors(stamped)).includes(root) ? stamped : undefined;
	}

	private async followUp(target: string, envelope: Envelope): Promise<void> {
		const id = this.asking.get(target);
		const job = id === undefined ? undefined : this.jobs.get(id);
		if (id === undefined || job === undefined || job.state !== "held") {
			await this.get(target).post(envelope);
			return;
		}
		this.asking.delete(target);
		job.state = "pending";
		job.envelope = envelope.id;
		await this.run(id, job, envelope);
	}

	private async run(
		id: string,
		job: Job,
		envelope: Envelope,
		options?: PostOptions,
	): Promise<void> {
		const posted = await this.get(job.thread).post(envelope, options);
		void posted.ended
			.then((outcome) => this.settle(id, job, outcome))
			.catch((error: unknown) =>
				console.error(`[ai] job=${id} was not settled:`, error),
			);
	}

	private async surface(
		thread: string,
		root: string,
		held: StepAnnotations,
	): Promise<void> {
		const { title } = await this.lineage(thread);
		const message: WireMessage = {
			id: crypto.randomUUID(),
			type: "tool",
			content: `agent ${title ?? thread} is waiting on you`,
			additional_kwargs: { ...held.output, thread },
		};
		await this.host.ports.transcript.append(root, [message]);
		this.get(root).relay(message);
	}

	wait(job: string, signal?: AbortSignal): Promise<TurnOutcome> {
		const entry = this.jobs.get(job);
		if (entry === undefined) return Promise.resolve(LOST);
		if (entry.outcome !== undefined) return Promise.resolve(entry.outcome);
		return new Promise((resolve, reject) => {
			const giveUp = () => {
				entry.waiter = undefined;
				reject(signal?.reason);
			};
			if (signal?.aborted) return giveUp();
			signal?.addEventListener("abort", giveUp, { once: true });
			entry.waiter = (outcome) => {
				signal?.removeEventListener("abort", giveUp);
				resolve(outcome);
			};
		});
	}

	state(id: string): Seen {
		const job = this.jobs.get(id);
		if (job !== undefined)
			return {
				job: id,
				state: job.state,
				...(job.outcome === undefined ? {} : { outcome: job.outcome }),
			};
		const live = this.live.get(id);
		if (live !== undefined)
			return { thread: id, state: live.thread.busy ? "busy" : "idle" };
		return { job: id, state: "lost", outcome: LOST };
	}

	async cancel(id: string): Promise<boolean> {
		const job = this.jobs.get(id);
		if (job !== undefined) {
			if (job.outcome !== undefined) return false;
			if (job.state === "held") {
				this.release(job);
				return true;
			}
			job.state = "cancelled";
			if (await this.get(job.thread).withdraw(job.envelope)) return true;
			return await this.cancel(job.thread);
		}
		return await this.halt([id, ...(await this.descendants(id))]);
	}

	stop(threadId: string): Promise<boolean> {
		return this.halt([threadId]);
	}

	private async halt(doomed: readonly string[]): Promise<boolean> {
		const released = doomed.map((threadId) => {
			const job = this.jobs.get(this.asking.get(threadId) ?? "");
			if (job === undefined || job.state !== "held") return false;
			this.release(job);
			return true;
		});
		const cancelled = await Promise.all(
			doomed.map((threadId) => this.live.get(threadId)?.thread.cancel()),
		);
		return [...released, ...cancelled].some((done) => done === true);
	}

	private release(job: Job): void {
		this.asking.delete(job.thread);
		job.state = "cancelled";
		job.outcome = CANCELLED;
		job.waiter?.(CANCELLED);
	}

	private async descendants(threadId: string): Promise<string[]> {
		await Promise.all(
			[...this.live.keys()].map((id) =>
				this.lineage(id).catch(() => undefined),
			),
		);
		const below: string[] = [];
		for (const id of this.parents.keys())
			if (id !== threadId && (await this.ancestors(id)).includes(threadId))
				below.push(id);
		return below;
	}

	private async settle(
		id: string,
		job: Job,
		outcome: TurnOutcome,
	): Promise<void> {
		if ("held" in outcome && job.state !== "cancelled") {
			const root = await this.root(job.thread);
			if (root !== job.thread) {
				job.state = "held";
				this.asking.set(job.thread, id);
				await this.surface(job.thread, root, outcome.held);
				return;
			}
		}
		job.outcome = outcome;
		if (job.state !== "cancelled")
			job.state =
				"held" in outcome ? "held" : "answer" in outcome ? "done" : "failed";
		if (job.waiter !== undefined) {
			job.waiter(outcome);
			return;
		}
		if (job.replyTo === undefined || job.state === "cancelled") return;
		const text = replyText(outcome);
		if (text !== undefined)
			void this.deliver(job, id, text, "stopped" in outcome);
	}

	private async deliver(
		job: Job,
		id: string,
		text: string,
		failed: boolean,
	): Promise<void> {
		const to = job.replyTo;
		if (to === undefined) return;
		const lineage = await this.lineage(job.thread).catch((): Lineage => ({}));
		const envelope: Envelope = {
			kind: "event",
			id: crypto.randomUUID(),
			source: `agent:${lineage.title ?? job.thread}`,
			text,
			replyTo: job.thread,
			job: id,
			...(failed ? { failed: true } : {}),
		};
		const onward = this.returns.get(to);
		try {
			if (onward === undefined) await this.get(to).post(envelope);
			else await this.ask(to, envelope, { replyTo: onward });
		} catch (error) {
			console.error(`[ai] job=${id} reply to ${to} was lost:`, error);
		}
	}

	private evict(keep: string): void {
		for (const [threadId, { thread }] of this.live) {
			if (this.live.size <= this.maxLive) return;
			if (threadId !== keep && !thread.busy) this.live.delete(threadId);
		}
	}
}
