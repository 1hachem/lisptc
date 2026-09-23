import { fileURLToPath } from "node:url";
import { Interp, prelude, runAsync, runSync } from "@repo/interpreter/lisp";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);

const interp = new Interp({
	extensions: [mcpExtension(mcpHost)],
});
runSync(interp, prelude);
await (runSync(
	interp,
	`(load-mcp :name "fx" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}")))`,
) as Promise<unknown>);
await runAsync(interp, '(fx/echo :message "hi")');
await runAsync(
	interp,
	process.argv[2] === "dispose" ? "(+ 1 1)" : "(mcp-shutdown)",
);
if (process.argv[2] === "dispose") interp.dispose();
