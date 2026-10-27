import type { AgentRepl } from "@repo/repl/repl";
import type { Awaitable } from "@repo/shared/host";

export interface Repls<Id extends string = string> {
	repl(threadId: Id): Awaitable<AgentRepl>;
}

export type ReplSource<Id extends string = string> =
	| { repl: AgentRepl; threadId?: string }
	| { repls: Repls<Id>; threadId: Id };

export function replFrom<Id extends string>(
	source: ReplSource<Id>,
): Awaitable<AgentRepl> {
	return "repl" in source ? source.repl : source.repls.repl(source.threadId);
}
