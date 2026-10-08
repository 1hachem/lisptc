import { runUiAction, type UiActionResult } from "@repo/ai";
import { api, internal } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { Hono } from "hono";
import { z } from "zod";
import { convexAs, convexAsServer, type ServerConvex } from "./convex.ts";
import { ticket } from "./events.ts";
import { convexId } from "./ids.ts";
import { repls } from "./repls.ts";
import { session } from "./session.ts";

const uiActionSchema = z.object({
	chatId: convexId<"chats">(),
	messageId: z.string().optional(),
	action: z.string(),
	values: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

async function annotateMessage(
	server: ServerConvex,
	chatId: Id<"chats">,
	id: string,
	kwargs: UiActionResult["annotations"],
): Promise<void> {
	if (kwargs === undefined || Object.keys(kwargs).length === 0) return;
	await server.mutation(internal.messages.annotate, { chatId, id, kwargs });
}

export const uiAction = new Hono();

uiAction.use(session);

uiAction.post("/", async (c) => {
	const parsed = uiActionSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		console.warn("rejected ui action:", z.treeifyError(parsed.error));
		return c.json({ error: z.treeifyError(parsed.error) }, 400);
	}
	const { chatId, messageId, action, values } = parsed.data;
	const convex = convexAs(c.get("session"));
	await convex.query(api.chats.get, { chatId });
	const result = await runUiAction(repls, chatId, action, values ?? {});
	if (!result) {
		console.log(`ui action chat=${chatId} action=${action} no-session`);
		return c.json({ error: "session expired" }, 409);
	}
	const { annotations, ...reply } = result;
	if (messageId !== undefined && !result.error)
		await annotateMessage(
			convexAsServer(c.get("session")),
			chatId,
			messageId,
			annotations,
		);
	const event =
		result.message === undefined || result.error
			? undefined
			: await ticket(
					{ subject: c.get("session").subject, chatId },
					{ source: action, text: result.message },
				);
	console.log(
		`ui action chat=${chatId} action=${action}${result.message ? " sent" : ""}${result.error ? " error" : ""}`,
	);
	return c.json(event === undefined ? reply : { ...reply, event });
});
