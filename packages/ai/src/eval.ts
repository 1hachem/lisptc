import { evalCode, replResultContent } from "./repl.ts";
import { type AgentReplOptions, getThreadRepl } from "./repl-store.ts";

export interface EvalMessage {
	type: "tool";
	content: string;
	id: string;
	additional_kwargs?: Record<string, unknown>;
}

export async function evalUserCode(
	code: string,
	threadId?: string,
	replOptions?: AgentReplOptions,
): Promise<EvalMessage> {
	const repl = getThreadRepl(threadId, replOptions);
	const { output, display, error, failed, annotations } = await evalCode(
		repl,
		code,
	);
	repl.clearTurnSignals();
	const extras: Record<string, unknown> = { ...annotations.output };
	if (display !== output) extras.display = display;
	if (failed) extras.failed = true;
	return {
		type: "tool",
		content: replResultContent(output, error),
		id: crypto.randomUUID(),
		...(Object.keys(extras).length > 0 ? { additional_kwargs: extras } : {}),
	};
}
