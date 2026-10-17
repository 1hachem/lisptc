import type { AgentRepl } from "@repo/repl/repl";
import type { Awaitable } from "@repo/shared/host";

const IDLE_MS = 30 * 60 * 1000;

export type OpenRepl<Id extends string = string> = (
	threadId: Id,
) => Awaitable<AgentRepl>;

export interface Closed {
	readonly saved: boolean;
}

export interface ReplStoreOptions<Id extends string = string> {
	readonly idleMs?: number;
	readonly closed?: (threadId: Id, closed: Closed) => Awaitable<void>;
}

interface Standing {
	readonly repl: AgentRepl;
	touchedAt: number;
	timer: ReturnType<typeof setTimeout>;
}

export class ReplStore<Id extends string = string> {
	private readonly repls = new Map<Id, Standing>();
	private readonly opening = new Map<Id, Promise<AgentRepl>>();
	private readonly closing = new Map<Id, Promise<void>>();

	private readonly idleMs: number;
	private readonly closed: ReplStoreOptions<Id>["closed"];

	constructor(
		private readonly open: OpenRepl<Id>,
		options: ReplStoreOptions<Id> = {},
	) {
		this.idleMs = options.idleMs ?? IDLE_MS;
		this.closed = options.closed;
	}

	peek(threadId: Id): AgentRepl | undefined {
		const standing = this.repls.get(threadId);
		if (standing === undefined) return undefined;
		this.keep(threadId, standing.repl);
		return standing.repl;
	}

	get(threadId: Id): Awaitable<AgentRepl> {
		const standing = this.peek(threadId);
		if (standing !== undefined) return standing;
		const opening = this.opening.get(threadId);
		if (opening !== undefined) return opening;
		const closing = this.closing.get(threadId);
		const opened =
			closing === undefined
				? Promise.resolve(this.open(threadId))
				: closing.then(() => this.open(threadId));
		const started = opened
			.then((repl) => {
				this.keep(threadId, repl);
				return repl;
			})
			.finally(() => this.opening.delete(threadId));
		this.opening.set(threadId, started);
		return started;
	}

	private keep(threadId: Id, repl: AgentRepl): void {
		const standing = this.repls.get(threadId);
		if (standing !== undefined) clearTimeout(standing.timer);
		this.repls.set(threadId, {
			repl,
			touchedAt: Date.now(),
			timer: this.lapseIn(threadId, repl, this.idleMs),
		});
	}

	private lapseIn(
		threadId: Id,
		repl: AgentRepl,
		ms: number,
	): ReturnType<typeof setTimeout> {
		const timer = setTimeout(() => this.lapse(threadId, repl), ms);
		timer.unref?.();
		return timer;
	}

	private lapse(threadId: Id, repl: AgentRepl): void {
		const standing = this.repls.get(threadId);
		if (standing?.repl !== repl) return;
		const { idleSince } = repl;
		const left =
			idleSince === undefined
				? this.idleMs
				: Math.max(standing.touchedAt, idleSince) + this.idleMs - Date.now();
		if (left > 0) {
			standing.timer = this.lapseIn(threadId, repl, left);
			return;
		}
		this.repls.delete(threadId);
		const closed = repl
			.close()
			.then(
				() => true,
				(ex) => {
					console.error(`[repls] thread ${threadId} closed unsaved:`, ex);
					return false;
				},
			)
			.then((saved) => this.closed?.(threadId, { saved }))
			.catch((ex) => {
				console.error(`[repls] thread ${threadId} closed unnoted:`, ex);
			})
			.finally(() => {
				if (this.closing.get(threadId) === closed)
					this.closing.delete(threadId);
			});
		this.closing.set(threadId, closed);
	}
}

export type ReplSource<Id extends string = string> =
	| { repl: AgentRepl; threadId?: string }
	| { repls: ReplStore<Id>; threadId: Id };

export function replFrom<Id extends string>(
	source: ReplSource<Id>,
): Awaitable<AgentRepl> {
	return "repl" in source ? source.repl : source.repls.get(source.threadId);
}
