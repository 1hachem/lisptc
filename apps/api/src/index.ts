import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { chat } from "./chat.ts";

const app = new Hono();

app.use("/api/*", cors());

app.get("/health", (c) => c.json({ ok: true }));

app.route("/api/chat", chat);

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port });
console.log(`@lisptc/api listening on http://localhost:${port}`);
