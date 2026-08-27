import { serve } from "@hono/node-server";
import {
	type ChatInput,
	LISP_SYSTEM_PROMPT,
	streamChatResponse,
} from "@repo/ai";
import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();

app.use("/api/*", cors());

app.get("/health", (c) => c.json({ ok: true }));

// The client's FetchStreamTransport posts `{ input, config, ... }`; the agent
// stream + LangGraph SSE framing all live in @repo/ai — this only routes.
app.post("/api/chat", async (c) => {
	const { input } = await c.req.json<{ input?: ChatInput }>();
	return streamChatResponse(
		input ?? {},
		{ system: LISP_SYSTEM_PROMPT },
		c.req.raw.signal,
	);
});

// A dropped SSE client (dev tools opening, tab reload) can surface as a late
// stream/socket error; keep the dev server alive instead of letting it exit.
process.on("unhandledRejection", (reason) => {
	console.error("[api] unhandledRejection:", reason);
});

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port });
console.log(`@lisptc/api listening on http://localhost:${port}`);
