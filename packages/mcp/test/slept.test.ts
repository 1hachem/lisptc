import { driveAsync, settled } from "@repo/interpreter/drive";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { openSession } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { localMcpClient, mcpHost } from "../src/mcp-host.ts";
import { MemoryOAuthStore } from "../src/oauth-host.ts";
import { fixtureServer, recordingHost, withServers } from "./helpers.ts";

async function loaded() {
	const host = recordingHost();
	const extension = mcpExtension(
		withServers(
			{
				...mcpHost,
				client: localMcpClient({ host, oauth: new MemoryOAuthStore() }),
			},
			fixtureServer("fx"),
		),
	);
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	await (runSync(interp, '(load-mcp "fx")') as Promise<unknown>);
	return { host, interp, hooks: openSession([extension]) };
}

async function turnStart(
	interp: Interp,
	hooks: ReturnType<typeof openSession>,
): Promise<string[]> {
	const emitted: string[] = [];
	await driveAsync(
		hooks.turnStart.run(() => settled(undefined), {
			interp,
			emit: (text) => emitted.push(text),
		}),
	);
	return emitted;
}

describe("a server that went to sleep", () => {
	it("records each tool call as a use", async () => {
		const { host, interp } = await loaded();
		await runAsync(interp, '(fx/echo :message "hi")');
		expect(host.uses).toEqual(["fx"]);
		interp.dispose();
	}, 30_000);

	it("says nothing at the next turn while it is awake", async () => {
		const { interp, hooks } = await loaded();
		expect(await turnStart(interp, hooks)).toEqual([]);
		expect(interp.hasGlobal(newSym("fx/echo"))).toBe(true);
		interp.dispose();
	}, 30_000);

	it("stays bound and quiet, then reconnects on its next call", async () => {
		const { host, interp, hooks } = await loaded();
		host.sleeping.add("fx");

		expect(await turnStart(interp, hooks)).toEqual([]);
		expect(interp.hasGlobal(newSym("fx/echo"))).toBe(true);
		expect(str(runSync(interp, "(list-mcps)"))).toContain('("fx" :dormant 3)');

		host.sleeping.delete("fx");
		expect(
			str((await runAsync(interp, '(fx/echo :message "back")')).value),
		).toBe('"back"');
		expect(str(runSync(interp, "(list-mcps)"))).toContain('("fx" :loaded 3)');
		interp.dispose();
	}, 30_000);
});
