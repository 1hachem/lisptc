import type { StepAnnotations } from "@repo/interpreter/session";
import type { AgentRepl } from "@repo/repl/repl";
import type { Awaitable } from "@repo/shared/host";
import { type ReplSource, replFrom } from "./repl-store.ts";
import type { TurnOutcome } from "./stream.ts";
import { type UiActionResult, uiActionOn } from "./ui-action.ts";

interface Waiting {
	readonly repl: () => Awaitable<AgentRepl>;
	readonly resume: (message: string) => void;
}

export class DelegatedAsks {
	private readonly waiting = new Map<string, Waiting>();

	wait<Id extends string>(
		id: string,
		source: ReplSource<Id>,
		signal: AbortSignal,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			const abandon = () => {
				this.waiting.delete(id);
				reject(signal.reason);
			};
			if (signal.aborted) return abandon();
			signal.addEventListener("abort", abandon, { once: true });
			this.waiting.set(id, {
				repl: () => replFrom(source),
				resume: (message) => {
					signal.removeEventListener("abort", abandon);
					this.waiting.delete(id);
					resolve(message);
				},
			});
		});
	}

	holds(id: string): boolean {
		return this.waiting.has(id);
	}

	async answer(
		id: string,
		action: string,
		values: Record<string, unknown>,
	): Promise<UiActionResult> {
		const waiting = this.waiting.get(id);
		if (waiting === undefined)
			return { output: "nothing is waiting on this ask", error: true };
		const result = await uiActionOn(await waiting.repl(), action, values);
		if (result.message !== undefined && !result.error)
			waiting.resume(result.message);
		return result;
	}
}

export type Reply = (message: string) => Promise<TurnOutcome>;

export type Surface = (held: StepAnnotations) => Promise<string>;

export async function converse(
	reply: Reply,
	message: string,
	surface: Surface,
): Promise<string> {
	let outcome = await reply(message);
	while ("held" in outcome) outcome = await reply(await surface(outcome.held));
	if ("stopped" in outcome) throw new Error(outcome.stopped);
	return outcome.answer;
}
