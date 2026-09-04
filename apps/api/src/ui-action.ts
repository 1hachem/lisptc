import { runUiAction } from "@repo/ai";
import { Hono } from "hono";
import { z } from "zod";

// A click on a widget an earlier turn rendered. `action` is the opaque handler
// id the frontend was given in the widget tree; `values` is the enclosing form's
// fields, which a plain button sends empty.
const uiActionSchema = z.object({
	thread_id: z.string(),
	action: z.string(),
	values: z.record(z.string(), z.string()).optional(),
});

/*
 * The other half of the chat loop, and the reason it is a separate route: this
 * one takes no model turn at all. The handler behind `action` runs in the
 * thread's live REPL and answers with a new view, so a widget can be driven for
 * as long as the thread lives without a single token being spent.
 *
 * A handler that calls `ui/send` answers with a `message` as well, which the
 * client posts to /api/chat as a user turn. Even then this route does not run the
 * agent: the transcript a run needs is held by the client.
 */
export const uiAction = new Hono();

uiAction.post("/", async (c) => {
	const parsed = uiActionSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		console.warn("rejected ui action:", z.treeifyError(parsed.error));
		return c.json({ error: z.treeifyError(parsed.error) }, 400);
	}
	const { thread_id, action, values } = parsed.data;
	const result = runUiAction(thread_id, action, values ?? {});
	// No REPL for the thread: the API restarted, or the thread was evicted from
	// the LRU. The widget is still on the reader's screen but nothing behind it
	// exists, which is a gone session rather than a failed click.
	if (!result) {
		console.log(`ui action thread=${thread_id} action=${action} no-session`);
		return c.json({ error: "session expired" }, 409);
	}
	console.log(
		`ui action thread=${thread_id} action=${action}${result.message ? " sent" : ""}${result.error ? " error" : ""}`,
	);
	return c.json(result);
});
