import { ensureWarm, warmStatus } from "@repo/ai";
import { apiEnv } from "@repo/env/api";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { chat } from "./chat.ts";
import { errorHandler } from "./error.ts";
import { NEEDS_WARMUP } from "./model.ts";

const app = new Hono();

// MIDDLEWARE
// `*`, not `/api/*`: the app polls /health to know when the KV warmup is done.
app.use(
	"*",
	// One origin, from `APP_URL`, rather than `*`: nothing but the app has any
	// business driving the agent, and an API that answers every origin is one
	// XSS on any page away from someone else's browser spending our tokens.
	//
	// Custom headers have to be named here or the browser refuses to send them.
	// Note where that failure lands: the preflight still answers 204, the
	// browser compares what it asked for against this list and gives up on its
	// own, so the symptom is a console error with nothing in the API log at all.
	// The `x-posthog-*` pair is added by posthog-js `tracing_headers` — both of
	// them, though only the session id is read — so omitting them breaks the
	// chat itself and not merely the telemetry riding along with it.
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

// ROUTES
app.get("/health", (c) =>
	c.json({ ok: true, warm: NEEDS_WARMUP ? warmStatus() : "skipped" }),
);

app.route("/api/chat", chat);

// ERROR HANDLING
app.onError(errorHandler);

// Not awaited: bind the port first, prime llama-server's KV in the background.
// The chat route awaits the same promise, so an early request queues behind it.
if (NEEDS_WARMUP) void ensureWarm();

// The vite dev server loads this module directly (see vite.config.ts); index.ts
// is the entry that serves it in production.
export default app;
