import { captureNote, isTelemetryEnabled } from "@repo/ai";
import { Hono } from "hono";
import { z } from "zod";

// A note is written by hand in the middle of a conversation, so the only
// required fields are the thread it belongs to and what was written. Everything
// else narrows it: a message id pins it to one turn, tags link it to notes on
// other threads.
const noteSchema = z.object({
	threadId: z.string().min(1),
	text: z.string().min(1).max(4000),
	target: z.enum(["conversation", "message"]).default("conversation"),
	messageId: z.string().optional(),
	messageIndex: z.number().int().nonnegative().optional(),
	messageExcerpt: z.string().max(2000).optional(),
	tags: z.array(z.string().min(1).max(64)).max(16).optional(),
});

export const note = new Hono();

// Notes are captured server-side rather than from the browser so the PostHog
// key stays on the server and a note lands in the same project (and under the
// same `$ai_trace_id`) as the trace it is about.
note.post("/", async (c) => {
	const parsed = noteSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		console.warn("rejected note:", z.treeifyError(parsed.error));
		return c.json({ error: z.treeifyError(parsed.error) }, 400);
	}
	const captured = await captureNote({
		...parsed.data,
		distinctId: c.req.header("x-distinct-id"),
		sessionId: c.req.header("x-posthog-session-id"),
	});
	console.log(
		`note thread=${parsed.data.threadId} target=${parsed.data.target}${captured ? "" : " (telemetry disabled — dropped)"}`,
	);
	// Not an error: a checkout with no PostHog project should still accept the
	// note gesture, and the client says so rather than pretending it landed.
	return c.json({ captured });
});

note.get("/", (c) => c.json({ enabled: isTelemetryEnabled() }));
