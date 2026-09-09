import { fileURLToPath } from "node:url";
import { Interp, prelude, runAsync, runSync } from "../src/lisp.ts";
import { mcpExtension } from "../src/mcp.ts";

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);

const interp = new Interp({ extensions: [mcpExtension()] });
runSync(interp, prelude);
await runAsync(
	interp,
	`(await (load-mcp :name "fx" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}"))))`,
);
await runAsync(interp, '(fx/echo :message "hi")');
await runAsync(
	interp,
	process.argv[2] === "dispose" ? "(+ 1 1)" : "(mcp-shutdown)",
);
if (process.argv[2] === "dispose") interp.dispose();
