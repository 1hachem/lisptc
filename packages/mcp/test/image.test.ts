import { fileURLToPath } from "node:url";
import { restore, snapshot } from "@repo/interpreter/image";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import type { LispPromise } from "@repo/interpreter/promise";
import { afterEach, describe, expect, it } from "vitest";
import { type McpExtensionHost, mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";
import type { ConnConfig } from "../src/ports.ts";
import { countingHost } from "./helpers.ts";

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);

const SLOW_LOAD = `(load-mcp :name "fx" :command "node" :env (quote (("LISPTC_FIXTURE_DELAY_MS" . "300"))) :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}")))`;

const LOAD = `(load-mcp :name "fx" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}")))`;

const opened: Interp[] = [];

function mcpInterp(
	host: McpExtensionHost = { ...mcpHost, commands: true },
): Interp {
	const interp = new Interp({ extensions: [mcpExtension(host)] });
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

function imaged(interp: Interp, host?: McpExtensionHost): Interp {
	const back = mcpInterp(host);
	restore(back, JSON.parse(JSON.stringify(snapshot(interp))));
	return back;
}

afterEach(() => {
	for (const interp of opened.splice(0)) interp.dispose();
});

describe("a loaded MCP server in an image", () => {
	it("keeps the server and the arguments it was loaded with as data the session can read but not set", async () => {
		const interp = await loaded();
		expect(await evalStr(interp, "(car (car (car *mcp/servers*)))")).toBe(
			'"args"',
		);
		expect(await evalStr(interp, "(car (car (cdr (car *mcp/servers*))))")).toBe(
			'"name"',
		);
		await expect(runAsync(interp, "(setq *mcp/servers* nil)")).rejects.toThrow(
			"read-only global owned by mcp",
		);
	});

	it("comes back dormant, with its tools and their docs still defined", async () => {
		const back = imaged(await loaded());
		expect(await evalStr(back, "(list-mcps)")).toContain('("fx" :dormant 3)');
		expect(back.docs().get("fx/echo")?.signature).toContain(":message");
	});

	it("reconnects on its first tool call and returns the result", async () => {
		const connects: ConnConfig[] = [];
		const back = imaged(
			await loaded(),
			countingHost({ ...mcpHost, commands: true }, connects),
		);
		expect(await evalStr(back, '(fx/echo :message "hi")')).toBe('"hi"');
		expect(await evalStr(back, "(list-mcps)")).toContain('("fx" :loaded 3)');
		expect(await evalStr(back, '(fx/echo :message "again")')).toBe('"again"');
		expect(connects.map((conf) => conf.name)).toEqual(["fx"]);
	});

	it("reconnects once for two calls made at the same time", async () => {
		const connects: ConnConfig[] = [];
		const back = imaged(
			await loaded(),
			countingHost({ ...mcpHost, commands: true }, connects),
		);
		const calls = [
			evalStr(back, '(fx/echo :message "a")'),
			evalStr(back, '(fx/echo :message "b")'),
		];
		expect(connects).toHaveLength(1);
		expect(str(runSync(back, "(list-mcps)"))).toContain('("fx" :dormant 3)');
		const results = await Promise.all(calls);
		expect(results).toEqual(['"a"', '"b"']);
		expect(connects).toHaveLength(1);
	});

	it("is marked failed with the reason when the reconnect fails", async () => {
		const back = imaged(
			await loaded(),
			countingHost(
				{ ...mcpHost, commands: true },
				[],
				new Error("no route to fx"),
			),
		);
		await expect(runAsync(back, '(fx/echo :message "hi")')).rejects.toThrow(
			"no route to fx",
		);
		expect(await evalStr(back, "(list-mcps)")).toContain('("fx" :failed 3)');
		await expect(runAsync(back, '(fx/echo :message "hi")')).rejects.toThrow(
			"fx is not connected (reconnect failed: no route to fx)",
		);
	});

	it("works again once it is loaded again", async () => {
		const back = imaged(await loaded());
		await (runSync(back, LOAD) as Promise<unknown>);
		expect(await evalStr(back, "(list-mcps)")).toContain('("fx" :loaded 3)');
		expect(await evalStr(back, '(fx/echo :message "hi")')).toBe('"hi"');
	});

	it("unloads a dormant server without a connection to close", async () => {
		const back = imaged(await loaded());
		await evalStr(back, '(unload-mcp "fx")');
		expect(await evalStr(back, "(list-mcps)")).not.toContain('"fx"');
		await expect(runAsync(back, '(fx/echo :message "hi")')).rejects.toThrow();
	});
});

describe("a load-mcp pending in an image", () => {
	it("completes after restore", async () => {
		const interp = mcpInterp();
		runSync(interp, `(setq loading ${SLOW_LOAD})`);
		const image = JSON.parse(JSON.stringify(snapshot(interp)));
		interp.dispose();
		const connects: ConnConfig[] = [];
		const back = mcpInterp(
			countingHost({ ...mcpHost, commands: true }, connects),
		);
		restore(back, image);
		await (back.getGlobal(newSym("loading")) as LispPromise);
		expect(connects.map((conf) => conf.name)).toEqual(["fx"]);
		expect(await evalStr(back, "(list-mcps)")).toContain('("fx" :loaded 3)');
		expect(await evalStr(back, '(fx/echo :message "hi")')).toBe('"hi"');
	});
});
