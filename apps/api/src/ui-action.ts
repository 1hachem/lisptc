import { runUiAction } from "@repo/ai";
import { api } from "@repo/backend/api";
import { Hono } from "hono";
import { z } from "zod";
import { convexAs } from "./convex.ts";
import { convexId } from "./ids.ts";
import { repls } from "./repls.ts";
import { session } from "./session.ts";

const uiActionSchema = z.object({
	chatId: convexId<"chats">(),
	action: z.string(),
	values: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

export const uiAction = new Hono();

uiAction.use(session);

uiAction.post("/", async (c) => {
	const parsed = uiActionSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		console.warn("rejected ui action:", z.treeifyError(parsed.error));
		return c.json({ error: z.treeifyError(parsed.error) }, 400);
	}
	const { chatId, action, values } = parsed.data;
	await convexAs(c.get("session")).query(api.chats.get, { chatId });
	const result = await runUiAction(repls, chatId, action, values ?? {});
	if (!result) {
		console.log(`ui action chat=${chatId} action=${action} no-session`);
		return c.json({ error: "session expired" }, 409);
	}
	console.log(
		`ui action chat=${chatId} action=${action}${result.message ? " sent" : ""}${result.error ? " error" : ""}`,
	);
	return c.json(result);
});
