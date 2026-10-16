import { evalCode, replResultContent } from "./repl.ts";
import { type ReplSource, replFrom } from "./repl-store.ts";
import type { SystemEvent } from "./system-event.ts";

export interface EvalMessage {
	type: "tool";
	content: string;
	id: string;
	additional_kwargs?: Record<string, unknown>;
}

export async function checkUserCode<Id extends string>(
	code: string,
	source: ReplSource<Id>,
): Promise<SystemEvent | undefined> {
	const repl = await replFrom(source);
	const { rejected } = await repl.admit(code);
	if (rejected === undefined) return undefined;
	return {
		source: "lisp-check",
		text: [
			"the user ran this code, and it was stopped before it ran:",
			code,
			rejected,
		].join("\n\n"),
	};
}

export async function evalUserCode<Id extends string>(
	code: string,
	source: ReplSource<Id>,
): Promise<EvalMessage> {
	const repl = await replFrom(source);
	const { output, display, error, failed, annotations, emitted } =
		await evalCode(repl, code);
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
