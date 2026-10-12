import { formsOnly, type Skipped } from "@repo/shared/lisp-forms";
import { evalCode, replResultContent } from "./repl.ts";
import { type ReplSource, replFrom } from "./repl-store.ts";

export interface EvalMessage {
	type: "tool";
	content: string;
	id: string;
	additional_kwargs?: Record<string, unknown>;
}

function runsAnything(message: string, unrun: readonly Skipped[]): boolean {
	let kept = message;
	for (const {
		span: [from, to],
	} of unrun)
		kept = kept.slice(0, from) + " ".repeat(to - from) + kept.slice(to);
	return formsOnly(kept).trim() !== "";
}

export async function evalUserMessage<Id extends string>(
	message: string,
	source: ReplSource<Id>,
): Promise<EvalMessage | undefined> {
	if (formsOnly(message).trim() === "") return undefined;
	const repl = await replFrom(source);
	if (!runsAnything(message, repl.unrun(message))) return undefined;
	const { output, display, error, failed, annotations, emitted, results } =
		await evalCode(repl, message);
	repl.clearTurnSignals();
	const extras: Record<string, unknown> = { ...annotations.output };
	if (display !== output) extras.display = display;
	if (failed) extras.failed = true;
	if (emitted !== "") extras.riding = emitted;
	if (results.length > 0) extras.results = results;
	return {
		type: "tool",
		content: replResultContent(output, error),
		id: crypto.randomUUID(),
		...(Object.keys(extras).length > 0 ? { additional_kwargs: extras } : {}),
	};
}
