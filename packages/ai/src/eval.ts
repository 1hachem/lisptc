import { nodeToJson, type UiValue } from "@repo/interpreter/ui";
import { evalCode, replResultContent } from "./repl.ts";
import { getThreadRepl } from "./repl-store.ts";

export interface EvalMessage {
	type: "tool";
	content: string;
	id: string;
	additional_kwargs?: { display?: string; ui?: UiValue };
}

export async function evalUserCode(
	code: string,
	threadId?: string,
): Promise<EvalMessage> {
	const repl = getThreadRepl(threadId);
	const { output, display, error, view } = await evalCode(repl, code);
	repl.clearTurnSignals();
	const extras: EvalMessage["additional_kwargs"] = {};
	if (display !== output) extras.display = display;
	if (view) extras.ui = nodeToJson(view);
	return {
		type: "tool",
		content: replResultContent(output, error),
		id: crypto.randomUUID(),
		...(Object.keys(extras).length > 0 ? { additional_kwargs: extras } : {}),
	};
}
