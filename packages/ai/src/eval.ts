import { evalCode, replResultContent } from "./repl.ts";
import { type ReplSource, replFrom } from "./repl-store.ts";
import type { SystemEvent } from "./system-event.ts";
import { writtenAs } from "./turn.ts";

export interface EvalMessage {
	type: "tool";
	content: string;
	id: string;
	additional_kwargs?: Record<string, unknown>;
}

export interface UserLine {
	type: "human";
	content: string;
	id: string;
	additional_kwargs?: Record<string, unknown>;
}

export type UserCheck =
	| { line: UserLine; admitted: string }
	| { line: UserLine; mistaken: SystemEvent };

export async function checkUserCode<Id extends string>(
	code: string,
	source: ReplSource<Id>,
): Promise<UserCheck> {
	const repl = await replFrom(source);
	const admission = await repl.admit(code);
	const id = crypto.randomUUID();
	if (admission.rejected === undefined) {
		const written = writtenAs(code, admission);
		return {
			admitted: admission.code,
			line: {
				type: "human",
				content: admission.code,
				id,
				...(written ? { additional_kwargs: { written } } : {}),
			},
		};
	}
	return {
		line: { type: "human", content: code, id },
		mistaken: {
			source: "lisp-check",
			text: [
				"the user ran this code, and it was stopped before it ran:",
				admission.code,
				admission.rejected,
			].join("\n\n"),
		},
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
