import { driveAsync, settled } from "@repo/interpreter/drive";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { openSession } from "@repo/interpreter/session";
import { afterEach, describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { localMcpClient, mcpHost } from "../src/mcp-host.ts";
import { MemoryOAuthStore } from "../src/oauth-host.ts";
import { type McpRegistry, memoryRegistry } from "../src/ports.ts";
import { fixtureServer, recordingHost, withServers } from "./helpers.ts";

const opened: Interp[] = [];

afterEach(() => {
	for (const interp of opened.splice(0)) interp.dispose();
});

function session(registry: McpRegistry) {
	const extension = mcpExtension({
		...withServers(
			{
				...mcpHost,
				client: localMcpClient({
					host: recordingHost(),
					oauth: new MemoryOAuthStore(),
				}),
			},
			fixtureServer("fx"),
		),
		registry,
	});
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	opened.push(interp);
	const hooks = openSession([extension]);
	const turn = async (): Promise<string[]> => {
		const emitted: string[] = [];
		await driveAsync(
			hooks.turnStart.run(() => settled(undefined), {
				interp,
				emit: (text) => emitted.push(text),
			}),
		);
		return emitted;
	};
	return { interp, turn };
}

describe("the workspace registry", () => {
	it("holds what a session loads, tools included", async () => {
		const registry = memoryRegistry();
		const { interp } = session(registry);
		await (runSync(interp, '(load-mcp "fx")') as Promise<unknown>);
		const [mount] = await registry.mounts();
		expect(mount.server).toBe("fx");
		expect(mount.conf).toBeUndefined();
		expect(mount.tools.map((tool) => tool.name)).toContain("echo");
	}, 30_000);

	it("binds a server another session loaded at the next turn, and says so", async () => {
		const registry = memoryRegistry();
		const a = session(registry);
		const b = session(registry);
		await (runSync(a.interp, '(load-mcp "fx")') as Promise<unknown>);

		const [notice] = await b.turn();

		expect(notice).toContain("bound here too: fx");
		expect(str(runSync(b.interp, "(list-mcps)"))).toContain(
			'("fx" :dormant 3)',
		);
		expect(
			str((await runAsync(b.interp, '(fx/echo :message "hi")')).value),
		).toBe('"hi"');
		expect(await b.turn()).toEqual([]);
	}, 30_000);

	it("drops a server another session unloaded at the next turn", async () => {
		const registry = memoryRegistry();
		const a = session(registry);
		const b = session(registry);
		await (runSync(a.interp, '(load-mcp "fx")') as Promise<unknown>);
		await b.turn();

		await runAsync(b.interp, '(unload-mcp "fx")');
		expect(await registry.mounts()).toEqual([]);
		const [notice] = await a.turn();

		expect(notice).toContain("unloaded elsewhere in this workspace: fx");
		expect(a.interp.hasGlobal(newSym("fx/echo"))).toBe(false);
	}, 30_000);

	it("rebinds a server whose tools changed", async () => {
		const registry = memoryRegistry();
		const a = session(registry);
		await (runSync(a.interp, '(load-mcp "fx")') as Promise<unknown>);
		const [mount] = await registry.mounts();
		registry.mount({
			...mount,
			tools: mount.tools.filter((tool) => tool.name === "echo"),
		});

		expect(await a.turn()).toEqual([]);

		expect(a.interp.hasGlobal(newSym("fx/echo"))).toBe(true);
		expect(str(runSync(a.interp, "(list-mcps)"))).toContain(
			'("fx" :dormant 1)',
		);
	}, 30_000);

	it("keeps the url and headers of an ad-hoc server so another session can reach it", async () => {
		const registry = memoryRegistry();
		registry.mount({
			server: "remote",
			conf: {
				name: "remote",
				url: "http://127.0.0.1:1/mcp",
				headers: { Authorization: "Bearer x" },
			},
			tools: [{ name: "ping" }],
		});
		const b = session(registry);
		await b.turn();
		expect(str(runSync(b.interp, "*mcp/servers*"))).toContain(
			':name "remote" :url "http://127.0.0.1:1/mcp" :headers (("Authorization" . "Bearer x"))',
		);
	});

	it("leaves the registry alone when a session is disposed", async () => {
		const registry = memoryRegistry();
		const { interp } = session(registry);
		await (runSync(interp, '(load-mcp "fx")') as Promise<unknown>);
		interp.dispose();
		expect((await registry.mounts()).map((mount) => mount.server)).toEqual([
			"fx",
		]);
	}, 30_000);

	it("empties on (mcp-shutdown)", async () => {
		const registry = memoryRegistry();
		const { interp } = session(registry);
		await (runSync(interp, '(load-mcp "fx")') as Promise<unknown>);
		runSync(interp, "(mcp-shutdown)");
		expect(await registry.mounts()).toEqual([]);
	}, 30_000);
});
