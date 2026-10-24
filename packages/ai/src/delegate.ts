import type { StepAnnotations } from "@repo/interpreter/session";
import type { AgentRepl } from "@repo/repl/repl";
import type { Conversation, Reply } from "./conversation.ts";
import { type UiActionResult, uiActionOn } from "./ui-action.ts";

interface Waiting {
	readonly repl: AgentRepl;
	readonly resume: (message: string) => void;
}

export class DelegatedAsks {
	private readonly waiting = new Map<string, Waiting>();

	wait(id: string, repl: AgentRepl, signal: AbortSignal): Promise<string> {
		return new Promise((resolve, reject) => {
			const abandon = () => {
				this.waiting.delete(id);
				reject(signal.reason);
			};
			if (signal.aborted) return abandon();
			signal.addEventListener("abort", abandon, { once: true });
			this.waiting.set(id, {
				repl,
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
		const result = await uiActionOn(waiting.repl, action, values);
		if (result.message !== undefined && !result.error)
			waiting.resume(result.message);
		return result;
	}
}

export type Surface = (held: StepAnnotations) => Promise<string>;

export async function converse(
	conversation: Conversation,
	message: string,
	reply: () => Reply,
	surface: Surface,
): Promise<string> {
	let replied = await conversation.reply(message, reply());
	while ("held" in replied)
		replied = await conversation.reply(await surface(replied.held), reply());
	return replied.answer;
}
