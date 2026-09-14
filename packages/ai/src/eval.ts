import { evalCode, replResultContent } from "./repl.ts";
import { getThreadRepl } from "./repl-store.ts";

export interface EvalMessage {
	type: "tool";
	content: string;
	id: string;
	additional_kwargs?: { display: string };
}

export async function evalUserCode(
	code: string,
	threadId?: string,
): Promise<EvalMessage> {
	const repl = getThreadRepl(threadId);
	const { output, display, error } = await evalCode(repl, code);
	repl.clearTurnSignals();
	return {
		type: "tool",
		content: replResultContent(output, error),
		id: crypto.randomUUID(),
		...(display !== output ? { additional_kwargs: { display } } : {}),
	};
}
