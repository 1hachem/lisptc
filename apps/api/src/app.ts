import { ensureWarm, warmStatus } from "@repo/ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { chat } from "./chat.ts";
import { errorHandler } from "./error.ts";
import { NEEDS_WARMUP } from "./model.ts";

const app = new Hono();

// MIDDLEWARE
// `*`, not `/api/*`: the app polls /health to know when the KV warmup is done.
app.use("*", cors());
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
