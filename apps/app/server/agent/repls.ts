import { ReplStore } from "@repo/ai";
import { chatRepls, draftRepls } from "@repo/backend/agent-repl";
import { convexAs, convexAsServer } from "./convex.ts";
import { currentSession } from "./session.ts";

export const repls = new ReplStore(
	chatRepls(() => convexAs(currentSession()), convexAsServer),
);

export const drafts = new ReplStore(
	draftRepls(() => convexAs(currentSession())),
);
