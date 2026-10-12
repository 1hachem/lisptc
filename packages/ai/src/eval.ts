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

export async function runsForms<Id extends string>(
	message: string,
	source: ReplSource<Id>,
): Promise<boolean> {
	if (formsOnly(message).trim() === "") return false;
	const repl = await replFrom(source);
	return runsAnything(message, repl.unrun(message));
}

export async function evalUserMessage<Id extends string>(
	message: string,
	source: ReplSource<Id>,
): Promise<EvalMessage | undefined> {
	if (!(await runsForms(message, source))) return undefined;
	const repl = await replFrom(source);
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
