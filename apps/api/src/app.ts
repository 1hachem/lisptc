import { ensureWarm, warmStatus } from "@repo/ai";
import { apiEnv } from "@repo/env/api";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { chat } from "./chat.ts";
import { errorHandler } from "./error.ts";
import { NEEDS_WARMUP } from "./model.ts";

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
		],
	}),
);
app.use(logger());

app.get("/health", (c) =>
	c.json({ ok: true, warm: NEEDS_WARMUP ? warmStatus() : "skipped" }),
);

app.route("/api/chat", chat);

app.onError(errorHandler);

if (NEEDS_WARMUP) void ensureWarm();

export default app;
