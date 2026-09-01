import { ensureWarm, warmStatus } from "@repo/ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { chat } from "./chat.ts";
import { errorHandler } from "./error.ts";
import { log } from "./log.ts";
import { NEEDS_WARMUP } from "./model.ts";
import { installProcessHandlers } from "./server.ts";

// Also from here, not just from `index.ts`: in dev this module is all vite
// loads, and an unhandled rejection is exactly what used to vanish.
installProcessHandlers();

const app = new Hono();

// `*`, not `/api/*`: the app polls /health to know when the KV warmup is done.
app.use("*", cors());
// Every request, in and out, so a hung stream or a 500 shows up in the
// `turbo run dev` output instead of only in the browser's network tab.
app.use(logger((msg, ...rest) => log.info([msg, ...rest].join(" "))));

app.get("/health", (c) =>
	c.json({ ok: true, warm: NEEDS_WARMUP ? warmStatus() : "skipped" }),
);

app.route("/api/chat", chat);

app.onError(errorHandler);

// Not awaited: bind the port first, prime llama-server's KV in the background.
// The chat route awaits the same promise, so an early request queues behind it.
if (NEEDS_WARMUP) void ensureWarm();

// The vite dev server loads this module directly (see vite.config.ts); `index.ts`
// is the entry that serves it in production.
export default app;
