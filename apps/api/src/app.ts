import { ensureWarm, warmStatus } from "@repo/ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { chat } from "./chat.ts";
import { errorHandler } from "./error.ts";
import { log } from "./log.ts";
import { NEEDS_WARMUP } from "./model.ts";

/**
 * The whole HTTP surface, built fresh on every call.
 *
 * `dev.ts` re-imports this module to hot-swap the app, so nothing here may hold
 * state at module scope: what has to survive a reload lives in `dev.ts`, and
 * everything else is rebuilt.
 */
export function createApp(): Hono {
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
	//
	// Kicked off from here rather than from the entry point because under HMR the
	// entry sits outside the reloaded graph: its `ensureWarm` would be a second
	// copy of the module, and the single-flight gate only holds within one copy.
	if (NEEDS_WARMUP) void ensureWarm();

	return app;
}
