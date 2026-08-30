import { serve } from "@hono/node-server";
import { ensureWarm, warmStatus } from "@repo/ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { chat } from "./chat.ts";

const app = new Hono();

// `*`, not `/api/*`: the app polls /health to know when the KV warmup is done.
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true, warm: warmStatus() }));

app.route("/api/chat", chat);

const port = Number(process.env.PORT ?? 3001);
const server = serve({ fetch: app.fetch, port });
console.log(`@lisptc/api listening on http://localhost:${port}`);

// Not awaited: bind the port first, prime llama-server's KV in the background.
// The chat route awaits the same promise, so an early request queues behind it.
void ensureWarm();

// The listening socket keeps the event loop alive, so without this the process
// outlives `task dev` and holds the port until it is killed by hand.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		server.close(() => process.exit(0));
	});
}
