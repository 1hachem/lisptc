import { serveFromArgv } from "@repo/repl/session-server";
import { findWorkspace } from "@repo/workspace-extension/host";
import { sessionExtensions } from "./extensions.ts";

await serveFromArgv(sessionExtensions(findWorkspace(process.cwd())));
