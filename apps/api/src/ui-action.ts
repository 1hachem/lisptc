import { runUiAction } from "@repo/ai";
import { Hono } from "hono";
import { z } from "zod";

const uiActionSchema = z.object({
	thread_id: z.string(),
	action: z.string(),
	values: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

export const uiAction = new Hono();

uiAction.post("/", async (c) => {
	const parsed = uiActionSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		console.warn("rejected ui action:", z.treeifyError(parsed.error));
		return c.json({ error: z.treeifyError(parsed.error) }, 400);
	}
	const { thread_id, action, values } = parsed.data;
	const result = await runUiAction(thread_id, action, values ?? {});
	if (!result) {
		console.log(`ui action thread=${thread_id} action=${action} no-session`);
		return c.json({ error: "session expired" }, 409);
	}
	console.log(
		`ui action thread=${thread_id} action=${action}${result.message ? " sent" : ""}${result.error ? " error" : ""}`,
	);
	return c.json(result);
});
