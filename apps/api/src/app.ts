import { apiEnv } from "@repo/env/api";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { chat } from "./chat.ts";
import { errorHandler } from "./error.ts";
import { telemetry } from "./telemetry.ts";
import { uiAction } from "./ui-action.ts";

const app = new Hono();

app.use(
	"*",
	cors({
		origin: apiEnv.APP_URL,
		allowHeaders: [
			"authorization",
			"content-type",
			"x-distinct-id",
			"x-posthog-distinct-id",
			"x-posthog-session-id",
			"x-posthog-window-id",
		],
	}),
);
app.use(telemetry());
app.use(logger());

app.get("/health", async (c) => {
	const convex = await fetch(new URL("/version", apiEnv.CONVEX_URL), {
		signal: AbortSignal.timeout(2000),
	})
		.then((response) => response.ok)
		.catch(() => false);
	return c.json({ ok: convex, convex }, convex ? 200 : 503);
});

app.route("/api/chat", chat);
app.route("/api/ui-action", uiAction);

app.onError(errorHandler);

export default app;
