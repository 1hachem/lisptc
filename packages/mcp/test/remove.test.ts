import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { afterEach, describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { localMcpClient, mcpHost } from "../src/mcp-host.ts";
import { MemoryOAuthStore } from "../src/oauth-host.ts";
import { type McpClient, memoryRegistry } from "../src/ports.ts";
import { fixtureServer, recordingHost, withServers } from "./helpers.ts";

const opened: Interp[] = [];

afterEach(() => {
	for (const interp of opened.splice(0)) interp.dispose();
});

function session() {
	const host = recordingHost();
	const registry = memoryRegistry();
	const extension = mcpExtension({
		...withServers(
			{
				...mcpHost,
				client: localMcpClient({ host, oauth: new MemoryOAuthStore() }),
			},
			fixtureServer("fx"),
		),
		registry,
	});
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	opened.push(interp);
	return { interp, host, registry };
}

describe("remove-mcp", () => {
	it("unloads a server, drops it from the workspace and deletes what runs it", async () => {
		const { interp, host, registry } = session();
		await (runSync(interp, '(load-mcp "fx")') as Promise<unknown>);

		const removed = await runAsync(interp, '(remove-mcp "fx")');

		expect(str(removed.value)).toBe(":removed");
		expect(host.removed).toEqual(["fx"]);
		expect(await registry.mounts()).toEqual([]);
		await expect(runAsync(interp, '(fx/echo :text "hi")')).rejects.toThrow();
	}, 30_000);

	it("deletes a toolkit server this session never loaded", async () => {
		const { interp, host } = session();

		await runAsync(interp, '(remove-mcp "fx")');

		expect(host.removed).toEqual(["fx"]);
	});

	it("drops a mounted server it cannot reach from the workspace, deleting nothing", async () => {
		const { interp, host, registry } = session();
		await registry.mount({ server: "desktop-only", tools: [] });

		const forgotten = await runAsync(interp, '(remove-mcp "desktop-only")');

		expect(str(forgotten.value)).toBe(":forgotten");
		expect(await registry.mounts()).toEqual([]);
		expect(host.removed).toEqual([]);
	});

	it("refuses a server the toolkit does not know", async () => {
		const { interp, host } = session();

		await expect(runAsync(interp, '(remove-mcp "nope")')).rejects.toThrow(
			/unknown MCP server/,
		);
		expect(host.removed).toEqual([]);
	});
});

const AUTH_URL = "https://auth.example/authorize?state=s-1";

function linkSession(authUrl: string | null) {
	const client: McpClient = {
		connect: () => Promise.reject(new Error("not used")),
		callTool: () => Promise.resolve(null),
		disconnect: () => Promise.resolve(),
		remove: () => Promise.resolve(),
		asleep: () => Promise.resolve(false),
		login: () => Promise.resolve({ authUrl }),
		logout: () => Promise.resolve(),
		authorize: () => Promise.resolve(),
		shutdown: () => Promise.resolve(),
	};
	const interp = new Interp({
		extensions: [mcpExtension({ ...mcpHost, client })],
	});
	runSync(interp, prelude);
	opened.push(interp);
	return interp;
}

describe("login :url", () => {
	it("hands back the authorization link instead of asking", async () => {
		const interp = linkSession(AUTH_URL);

		const result = await runAsync(interp, '(login "linear" :url t)');

		expect(result.value).toBe(AUTH_URL);
	});

	it("still says :logged-in when there is nothing to authorize", async () => {
		const interp = linkSession(null);

		const result = await runAsync(interp, '(login "linear" :url t)');

		expect(str(result.value)).toBe(":logged-in");
	});

	it("refuses an option it does not take", async () => {
		const interp = linkSession(AUTH_URL);

		await expect(runAsync(interp, '(login "linear" :link t)')).rejects.toThrow(
			/only :url/,
		);
	});
});
