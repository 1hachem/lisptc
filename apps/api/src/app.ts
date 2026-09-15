import { apiEnv } from "@repo/env/api";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { chat } from "./chat.ts";
import { errorHandler } from "./error.ts";
import { uiAction } from "./ui-action.ts";

const app = new Hono();

app.use(
	"*",
	cors({
		origin: apiEnv.APP_URL,
		allowHeaders: [
			"content-type",
			"x-distinct-id",
			"x-posthog-distinct-id",
			"x-posthog-session-id",
			"x-posthog-window-id",
		],
	}),
);
app.use(logger());

app.get("/health", (c) => c.json({ ok: true }));

app.route("/api/chat", chat);
app.route("/api/ui-action", uiAction);

app.onError(errorHandler);

export default app;
