import { ReplStore } from "@repo/ai";
import { chatRepls } from "@repo/backend/agent-repl";
import { convexAs } from "./convex.ts";
import { currentSession } from "./session.ts";

export const repls = new ReplStore(chatRepls(() => convexAs(currentSession())));
