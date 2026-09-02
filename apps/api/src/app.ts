import { ensureWarm, warmStatus } from "@repo/ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { chat } from "./chat.ts";
import { errorHandler } from "./error.ts";
import { NEEDS_WARMUP } from "./model.ts";
import { note } from "./note.ts";

const app = new Hono();

// MIDDLEWARE
// `*`, not `/api/*`: the app polls /health to know when the KV warmup is done.
app.use(
	"*",
	// Custom headers have to be named explicitly or the preflight rejects every
	// chat and note request from the browser. The `x-posthog-*` pair is added by
	// posthog-js `tracing_headers`, so leaving them out here breaks the chat
	// itself, not just the telemetry that reads them.
	cors({
		origin: "*",
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
app.route("/api/note", note);

// ERROR HANDLING
app.onError(errorHandler);

// Not awaited: bind the port first, prime llama-server's KV in the background.
// The chat route awaits the same promise, so an early request queues behind it.
if (NEEDS_WARMUP) void ensureWarm();

// The vite dev server loads this module directly (see vite.config.ts); index.ts
// is the entry that serves it in production.
export default app;
