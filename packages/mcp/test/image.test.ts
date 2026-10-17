import { fileURLToPath } from "node:url";
import { restore, snapshot } from "@repo/interpreter/image";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { str } from "@repo/interpreter/print";
import { afterEach, describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);

const LOAD = `(load-mcp :name "fx" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}")))`;

const opened: Interp[] = [];

function mcpInterp(): Interp {
	const interp = new Interp({ extensions: [mcpExtension(mcpHost)] });
	opened.push(interp);
	return interp;
}

async function evalStr(interp: Interp, code: string): Promise<string> {
	return str((await runAsync(interp, code)).value);
}

async function loaded(): Promise<Interp> {
	const interp = mcpInterp();
	await (runSync(interp, LOAD) as Promise<unknown>);
	return interp;
}

function imaged(interp: Interp): Interp {
	const back = mcpInterp();
	restore(back, JSON.parse(JSON.stringify(snapshot(interp))));
	return back;
}

afterEach(() => {
	for (const interp of opened.splice(0)) interp.dispose();
});

describe("a loaded MCP server in an image", () => {
	it("keeps the server as data the session can read but not set", async () => {
		const interp = await loaded();
		expect(await evalStr(interp, "(car (car (car *mcp/servers*)))")).toBe(
			'"name"',
		);
		await expect(runAsync(interp, "(setq *mcp/servers* nil)")).rejects.toThrow(
			"read-only global owned by mcp",
		);
	});

	it("comes back failed, with its tools and their docs still defined", async () => {
		const back = imaged(await loaded());
		expect(await evalStr(back, "(list-mcps)")).toContain('("fx" :failed 3)');
		expect(back.docs().get("fx/echo")?.signature).toContain(":message");
		await expect(runAsync(back, '(fx/echo :message "hi")')).rejects.toThrow(
			'load it again with (load-mcp "fx")',
		);
	});

	it("works again once it is loaded again", async () => {
		const back = imaged(await loaded());
		await (runSync(back, LOAD) as Promise<unknown>);
		expect(await evalStr(back, "(list-mcps)")).toContain('("fx" :loaded 3)');
		expect(await evalStr(back, '(fx/echo :message "hi")')).toBe('"hi"');
	});

	it("unloads a failed server without a connection to close", async () => {
		const back = imaged(await loaded());
		await evalStr(back, '(unload-mcp "fx")');
		expect(await evalStr(back, "(list-mcps)")).not.toContain('"fx"');
		await expect(runAsync(back, '(fx/echo :message "hi")')).rejects.toThrow();
	});
});
