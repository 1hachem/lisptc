import type { ConversationRecord } from "@repo/interpreter/conversation";
import type { AgentRepl } from "@repo/repl/repl";
import type { Entry } from "@repo/shared/journal";
import type { Repls } from "./repl-store.ts";

export interface UiActionResult {
	output: string;
	error: boolean;
	entries: readonly Entry[];
}

interface UiActionRun extends UiActionResult {
	notes: readonly ConversationRecord[];
}

export async function runUiAction<Id extends string>(
	repls: Repls<Id>,
	threadId: Id,
	action: string,
	values: Record<string, unknown>,
): Promise<UiActionResult> {
	return uiActionOn(await repls.repl(threadId), action, values);
}

export async function uiActionOn(
	repl: AgentRepl,
	action: string,
	values: Record<string, unknown>,
): Promise<UiActionRun> {
	try {
		const { user, entries, failed, notes } = await repl.invokeUi(
			action,
			values,
		);
		return {
			output: user,
			error: failed,
			entries,
			notes,
		};
	} catch (ex) {
		return {
			output: ex instanceof Error ? ex.message : String(ex),
			error: true,
			entries: [],
			notes: [],
		};
	}
}
