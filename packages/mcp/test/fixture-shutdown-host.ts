import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";
import { fixtureServer, withServers } from "./helpers.ts";

const interp = new Interp({
	extensions: [mcpExtension(withServers(mcpHost, fixtureServer("fx")))],
});
runSync(interp, prelude);
await (runSync(interp, '(load-mcp "fx")') as Promise<unknown>);
await runAsync(interp, '(fx/echo :message "hi")');
await runAsync(
	interp,
	process.argv[2] === "dispose" ? "(+ 1 1)" : "(mcp-shutdown)",
);
if (process.argv[2] === "dispose") interp.dispose();
