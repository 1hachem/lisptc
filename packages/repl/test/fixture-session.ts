import { proseExtension } from "@repo/interpreter/prose";
import { serveFromArgv } from "../src/session-server.ts";

await serveFromArgv([proseExtension()]);
