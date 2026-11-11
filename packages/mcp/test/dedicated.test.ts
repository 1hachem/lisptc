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
import { memoryRegistry } from "../src/ports.ts";
import { fixtureServer, recordingHost, withServers } from "./helpers.ts";

const opened: Interp[] = [];

afterEach(() => {
	for (const interp of opened.splice(0)) interp.dispose();
});

function chatSession(instance?: string) {
	const host = recordingHost();
	const registry = memoryRegistry();
	const extension = mcpExtension({
		...withServers(
			{
				...mcpHost,
				client: localMcpClient({ host, oauth: new MemoryOAuthStore() }),
			},
			{ ...fixtureServer("fx"), image: "ghcr.io/o/fx:main", port: 8000 },
		),
		registry,
		...(instance === undefined ? {} : { instance }),
	});
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	opened.push(interp);
	return { host, registry, interp, extension };
}

async function bothLoaded() {
	const { host, registry, interp, extension } = chatSession("chat-a");
	await (runSync(interp, '(load-mcp "fx")') as Promise<unknown>);
	await (runSync(interp, '(load-mcp "fx" :dedicated t)') as Promise<unknown>);
	const hooks = openSession([extension]);
	const turn = () =>
		driveAsync(
			hooks.turnStart.run(() => settled(undefined), {
				interp,
				emit: () => {},
			}),
		);
	return { host, registry, interp, turn };
}

const servers = async (registry: ReturnType<typeof memoryRegistry>) =>
	(await registry.mounts()).map((mount) => mount.server);

describe("a chat's own instance beside the workspace's", () => {
	it("binds under its own name, keeping the shared one, and stays out of the workspace", async () => {
		const { registry, interp } = await bothLoaded();
		expect(interp.hasGlobal(newSym("fx/echo"))).toBe(true);
		expect(interp.hasGlobal(newSym("fx-own/echo"))).toBe(true);
		expect(
			str((await runAsync(interp, '(fx-own/echo :message "mine")')).value),
		).toBe('"mine"');
		expect(
			str((await runAsync(interp, '(fx/echo :message "ours")')).value),
		).toBe('"ours"');
		expect(await servers(registry)).toEqual(["fx"]);
	}, 30_000);

	it("survives the next turn's reconcile with the workspace", async () => {
		const { interp, turn } = await bothLoaded();
		await turn();
		expect(interp.hasGlobal(newSym("fx-own/echo"))).toBe(true);
		expect(interp.hasGlobal(newSym("fx/echo"))).toBe(true);
	}, 30_000);

	it("unloads alone, leaving the shared one bound and mounted", async () => {
		const { registry, interp } = await bothLoaded();
		await runAsync(interp, '(unload-mcp "fx-own")');
		expect(interp.hasGlobal(newSym("fx-own/echo"))).toBe(false);
		expect(interp.hasGlobal(newSym("fx/echo"))).toBe(true);
		expect(await servers(registry)).toEqual(["fx"]);
	}, 30_000);

	it("runs as the chat's own instance, beside the shared one", async () => {
		const { host } = await bothLoaded();
		expect(
			host.ensured.map((conf) =>
				"instance" in conf ? conf.instance : undefined,
			),
		).toEqual([undefined, "chat-a"]);
	}, 30_000);

	it("cannot be loaded by a session that belongs to no chat", async () => {
		const { interp } = chatSession();
		await expect(
			runAsync(interp, '(load-mcp "fx" :dedicated t)'),
		).rejects.toThrow(/belongs to no chat of its own/);
	}, 30_000);

	it("removes only its own instance", async () => {
		const { host, registry, interp } = await bothLoaded();
		await runAsync(interp, '(remove-mcp "fx-own")');
		expect(host.removed).toEqual(["fx"]);
		expect(interp.hasGlobal(newSym("fx-own/echo"))).toBe(false);
		expect(interp.hasGlobal(newSym("fx/echo"))).toBe(true);
		expect(await servers(registry)).toEqual(["fx"]);
	}, 30_000);
});
