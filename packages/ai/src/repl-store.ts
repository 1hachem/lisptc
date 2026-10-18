import type { AgentRepl } from "@repo/repl/repl";
import type { Awaitable } from "@repo/shared/host";

const MAX_THREADS = 50;

export type OpenRepl<Id extends string = string> = (
	threadId: Id,
) => Awaitable<AgentRepl>;

export class ReplStore<Id extends string = string> {
	private readonly repls = new Map<Id, AgentRepl>();
	private readonly opening = new Map<Id, Promise<AgentRepl>>();

	constructor(
		private readonly open: OpenRepl<Id>,
		private readonly max: number = MAX_THREADS,
	) {}

	peek(threadId: Id): AgentRepl | undefined {
		const standing = this.repls.get(threadId);
		if (standing === undefined) return undefined;
		this.keep(threadId, standing);
		return standing;
	}

	get(threadId: Id): Awaitable<AgentRepl> {
		const standing = this.peek(threadId);
		if (standing !== undefined) return standing;
		const opening = this.opening.get(threadId);
		if (opening !== undefined) return opening;
		const started = Promise.resolve(this.open(threadId))
			.then((repl) => {
				this.keep(threadId, repl);
				return repl;
			})
			.finally(() => this.opening.delete(threadId));
		this.opening.set(threadId, started);
		return started;
	}

	private keep(threadId: Id, repl: AgentRepl): void {
		this.repls.delete(threadId);
		this.repls.set(threadId, repl);
		while (this.repls.size > this.max) {
			const oldest = this.repls.keys().next().value;
			if (oldest === undefined) break;
			this.repls.delete(oldest);
		}
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
