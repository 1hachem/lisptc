import { webEnv } from "@repo/env/web";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { chat } from "./chat.ts";
import { errorHandler } from "./error.ts";
import { oauthCallback } from "./oauth-callback.ts";
import { telemetry } from "./telemetry.ts";
import { uiAction } from "./ui-action.ts";

const agent = new Hono();

agent.use(telemetry());
agent.use(logger());

agent.get("/health", async (c) => {
	const convex = await fetch(new URL("/version", webEnv.CONVEX_URL), {
		signal: AbortSignal.timeout(2000),
	})
		.then((response) => response.ok)
		.catch(() => false);
	return c.json({ ok: convex, convex }, convex ? 200 : 503);
});

agent.route("/api/chat", chat);
agent.route("/api/ui-action", uiAction);
agent.route("/api/oauth/callback", oauthCallback);

agent.onError(errorHandler);

export default agent;
