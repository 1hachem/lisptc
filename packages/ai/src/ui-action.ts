/**
 * Running a click.
 *
 * A widget the agent rendered (see @repo/interpreter's ui.ts) carries handler
 * ids, not code. When the user presses a button or submits a form, the frontend
 * sends the id back here and the closure behind it runs in the thread's live
 * `AgentRepl` — same interpreter, same definitions, same loaded MCP servers as
 * the turn that drew the widget.
 *
 * No model is involved. That is the point of the whole feature: an interaction
 * the agent anticipated when it wrote the view costs a REPL evaluation and zero
 * tokens. It is also why nothing here touches the transcript — the model is not
 * told the click happened, so it cannot be confused by state it never saw
 * change. (A later turn reads the interpreter, which HAS changed, the same way
 * it reads anything else.)
 *
 * A handler that calls `ui/send` opts out of that: its message comes back in
 * `message` and the client posts it as an ordinary user turn, which starts a
 * normal run. Even then this route does not stream one itself — the transcript
 * a run needs is held by the client, not here.
 */

import { nodeToJson, type UiValue } from "@repo/interpreter/ui.ts";
import { peekThreadRepl } from "./repl-store.ts";

export interface UiActionResult {
	/** what the handler echoed, uncapped — this text is for the human only */
	output: string;
	error: boolean;
	/** the widget tree the handler rendered, if it rendered one */
	view?: UiValue;
	/**
	 * What the handler asked to say to the agent (`ui/send`). The client sends it
	 * as a user turn on its own, rather than this route starting a run: the chat
	 * transport is stateless, so the transcript a turn needs lives in the browser
	 * and not here.
	 */
	message?: string;
}

/*
 * Run one action. Returns undefined when the thread has no live REPL, which the
 * caller should report as a dead session rather than as a failed click: there is
 * nothing to retry, the view is simply stale.
 */
export function runUiAction(
	threadId: string,
	action: string,
	values: Record<string, unknown>,
): UiActionResult | undefined {
	const repl = peekThreadRepl(threadId);
	if (!repl) return undefined;
	try {
		const { user, view, message, error } = repl.invokeUi(action, values);
		return {
			output: user,
			error,
			view: view ? nodeToJson(view) : undefined,
			message,
		};
	} catch (ex) {
		// A host-level failure (not a Lisp error). Unlike an eval, this does NOT
		// reset the interpreter: a click is not worth destroying a conversation's
		// accumulated state over.
		return {
			output: ex instanceof Error ? ex.message : String(ex),
			error: true,
		};
	}
}
