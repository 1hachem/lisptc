import { serveFromArgv } from "@repo/repl/session-server";
import { sessionExtensions } from "./extensions.ts";

await serveFromArgv(sessionExtensions());
