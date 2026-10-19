import { ReplStore } from "@repo/ai";
import { chatRepls } from "@repo/backend/agent-repl";
import { convexAs, convexAsServer } from "./convex.ts";
import { currentSession } from "./session.ts";
import { subAgents } from "./sub-agents.ts";

const connect = () => convexAs(currentSession());

export const repls = new ReplStore(
	chatRepls(connect, convexAsServer, subAgents(connect)),
);
