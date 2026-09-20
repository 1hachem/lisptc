import { proseExtension } from "@repo/prose-extension";
import { serveFromArgv } from "../src/session-server.ts";

await serveFromArgv([proseExtension()]);
