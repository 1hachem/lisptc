import { quiets } from "@repo/interpreter/effects";
import type { AgentRepl } from "@repo/repl/repl";
import { formsOnly, type Skipped } from "@repo/shared/lisp-forms";
import { evalMessageCode } from "./repl.ts";
import { type ReplSource, replFrom } from "./repl-store.ts";
import { type ToolMessage, toolMessage } from "./tool-message.ts";

export type EvalMessage = ToolMessage;

export interface Evaluated {
	message: EvalMessage;
	quiet: boolean;
}

function runsAnything(message: string, unrun: readonly Skipped[]): boolean {
	let kept = message;
	for (const {
		span: [from, to],
	} of unrun)
		kept = kept.slice(0, from) + " ".repeat(to - from) + kept.slice(to);
	return formsOnly(kept).trim() !== "";
}

export async function evalMessage(
	repl: AgentRepl,
	message: string,
): Promise<Evaluated | undefined> {
	if (formsOnly(message).trim() === "") return undefined;
	if (!runsAnything(message, repl.unrun(message))) return undefined;
	const id = crypto.randomUUID();
	const { effects, emitted, ...outcome } = await evalMessageCode(
		repl,
		message,
		id,
	);
	const quiet = quiets(effects);
	return {
		message: toolMessage(
			{ ...outcome, quiet, ...(emitted === "" ? {} : { riding: emitted }) },
			id,
		),
		quiet,
	};
}

export async function evalUserMessage<Id extends string>(
	message: string,
	source: ReplSource<Id>,
): Promise<Evaluated | undefined> {
	if (formsOnly(message).trim() === "") return undefined;
	return evalMessage(await replFrom(source), message);
}
