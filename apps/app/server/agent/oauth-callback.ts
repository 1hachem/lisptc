import { finishOAuth } from "@repo/backend/oauth-callback";
import { Hono } from "hono";
import { z } from "zod";
import { convexAs } from "./convex.ts";
import { session } from "./session.ts";

const oauthCallbackSchema = z.object({ url: z.url() });

export const oauthCallback = new Hono();

oauthCallback.use(session);

oauthCallback.post("/", async (c) => {
	const parsed = oauthCallbackSchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!parsed.success) {
		console.warn("rejected oauth callback:", z.treeifyError(parsed.error));
		return c.json({ error: z.treeifyError(parsed.error) }, 400);
	}
	const current = c.get("session");
	const finished = await finishOAuth(() => convexAs(current), parsed.data.url);
	if (finished === null) {
		return c.json({ error: "no authorization is waiting for this link" }, 404);
	}
	console.log("oauth callback finished");
	return c.json({ ok: true, server: finished.server });
});
