import { ReplStore } from "@repo/ai";
import { chatReplClosed, chatRepls } from "@repo/backend/agent-repl";
import { convexAs, convexAsServer } from "./convex.ts";
import { currentSession } from "./session.ts";

export const repls = new ReplStore(
	chatRepls(() => convexAs(currentSession()), convexAsServer),
	{ closed: chatReplClosed(convexAsServer) },
);
