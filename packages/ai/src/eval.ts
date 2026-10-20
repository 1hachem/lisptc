import { quiets } from "@repo/interpreter/effects";
import type { AgentRepl } from "@repo/repl/repl";
import { formsOnly, type Skipped } from "@repo/shared/lisp-forms";
import {
	checkResultContent,
	evalMessageCode,
	replResultContent,
} from "./repl.ts";
import { type ReplSource, replFrom } from "./repl-store.ts";

export interface EvalMessage {
	type: "tool";
	content: string;
	id: string;
	additional_kwargs?: Record<string, unknown>;
}

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
	const { code, rejected, problems = [] } = await repl.admit(message);
	if (rejected !== undefined)
		return {
			message: {
				type: "tool",
				content: checkResultContent(rejected, problems),
				id: crypto.randomUUID(),
				additional_kwargs: { failed: true },
			},
			quiet: false,
		};
	const id = crypto.randomUUID();
	const {
		output,
		display,
		error,
		failed,
		annotations,
		effects,
		emitted,
		results,
	} = await evalMessageCode(repl, code, id);
	const extras: Record<string, unknown> = { ...annotations.output };
	if (display !== output) extras.display = display;
	if (failed) extras.failed = true;
	if (emitted !== "") extras.riding = emitted;
	if (results.length > 0) extras.results = results;
	return {
		message: {
			type: "tool",
			content: replResultContent(output, error),
			id,
			...(Object.keys(extras).length > 0 ? { additional_kwargs: extras } : {}),
		},
		quiet: quiets(effects),
	};
}

export async function evalUserMessage<Id extends string>(
	message: string,
	source: ReplSource<Id>,
): Promise<Evaluated | undefined> {
	if (formsOnly(message).trim() === "") return undefined;
	return evalMessage(await replFrom(source), message);
}
