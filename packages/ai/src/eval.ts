import { formsOnly } from "@repo/shared/lisp-forms";
import { evalCode, replResultContent } from "./repl.ts";
import { type ReplSource, replFrom } from "./repl-store.ts";

export interface EvalMessage {
	type: "tool";
	content: string;
	id: string;
	additional_kwargs?: Record<string, unknown>;
}

export async function evalUserMessage<Id extends string>(
	message: string,
	source: ReplSource<Id>,
): Promise<EvalMessage | undefined> {
	if (formsOnly(message).trim() === "") return undefined;
	const repl = await replFrom(source);
	const { output, display, error, failed, annotations, emitted } =
		await evalCode(repl, message);
	repl.clearTurnSignals();
	const extras: Record<string, unknown> = { ...annotations.output };
	if (display !== output) extras.display = display;
	if (failed) extras.failed = true;
	if (emitted !== "") extras.riding = emitted;
	return {
		type: "tool",
		content: replResultContent(output, error),
		id: crypto.randomUUID(),
		...(Object.keys(extras).length > 0 ? { additional_kwargs: extras } : {}),
	};
}
