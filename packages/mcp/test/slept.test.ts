import { driveAsync, settled } from "@repo/interpreter/drive";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { newLispKeyword, newSym } from "@repo/interpreter/objects";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { type Notice, openSession } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { localMcpClient, mcpHost } from "../src/mcp-host.ts";
import { MemoryOAuthStore } from "../src/oauth-host.ts";
import { fixtureServer, recordingHost, withServers } from "./helpers.ts";

function fresh() {
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
	return { host, interp, hooks: openSession([extension]) };
}

async function loaded() {
	const held = fresh();
	await (runSync(held.interp, '(load-mcp "fx")') as Promise<unknown>);
	return held;
}

async function beginStep(
	interp: Interp,
	hooks: ReturnType<typeof openSession>,
): Promise<Notice[]> {
	const notices: Notice[] = [];
	await driveAsync(
		hooks.beginStep.run(() => settled(undefined), {
			interp,
			emit: () => {},
			notify: (source, text) => notices.push({ source, text }),
		}),
	);
	return notices;
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
			notify: () => {},
		}),
	);
	return emitted;
}

describe("a server the chat holds", () => {
	it("records each tool call as a use", async () => {
		const { host, interp } = await loaded();
		await runAsync(interp, '(fx/echo :message "hi")');
		expect(host.uses).toEqual(["fx"]);
		interp.dispose();
	}, 30_000);

	it("is recorded :ready once loaded, and says nothing while it stays so", async () => {
		const { interp, hooks } = await loaded();

		expect(runSync(interp, '(mcp/phase "fx")')).toBe(newLispKeyword("ready"));
		expect(await beginStep(interp, hooks)).toEqual([]);
		expect(interp.hasGlobal(newSym("fx/echo"))).toBe(true);
		interp.dispose();
	}, 30_000);

	it("stays bound and quiet when it goes to sleep, then reconnects on its next call", async () => {
		const { host, interp, hooks } = await loaded();
		host.phases.set("fx", { phase: "sleeping" });

		expect(await turnStart(interp, hooks)).toEqual([]);
		expect(await beginStep(interp, hooks)).toEqual([]);
		expect(interp.hasGlobal(newSym("fx/echo"))).toBe(true);
		expect(str(runSync(interp, "(list-mcps)"))).toContain('("fx" :dormant 3)');

		host.phases.delete("fx");
		expect(
			str((await runAsync(interp, '(fx/echo :message "back")')).value),
		).toBe('"back"');
		expect(str(runSync(interp, "(list-mcps)"))).toContain('("fx" :loaded 3)');
		interp.dispose();
	}, 30_000);

	it("is unloaded and told why when it fails, the reason read as a string", async () => {
		const { host, interp, hooks } = await loaded();
		host.phases.set("fx", { phase: "failed", reason: 'image "fx" not found' });

		expect(await beginStep(interp, hooks)).toEqual([
			{
				source: "mcp",
				text: '(mcp/observe "fx" :failed "image \\"fx\\" not found")\n=> fx failed: image "fx" not found. Its tools were unloaded.',
			},
		]);
		expect(interp.hasGlobal(newSym("fx/echo"))).toBe(false);
		expect(runSync(interp, '(mcp/phase "fx")')).toBeNull();
		expect(await beginStep(interp, hooks)).toEqual([]);
		interp.dispose();
	}, 30_000);

	it("is unloaded and told when it is removed from the workspace", async () => {
		const { host, interp, hooks } = await loaded();
		host.phases.set("fx", { phase: "gone" });

		const [notice] = await beginStep(interp, hooks);

		expect(notice?.text).toBe(
			'(mcp/observe "fx" :gone nil)\n=> fx was removed from the workspace.',
		);
		expect(interp.hasGlobal(newSym("fx/echo"))).toBe(false);
		interp.dispose();
	}, 30_000);

	it("answers through the handler the agent gave it", async () => {
		const { host, interp, hooks } = await loaded();
		runSync(
			interp,
			'(mcp/on-change "fx" (lambda (name old new reason) (format "~a went from ~a to ~a" name old new)))',
		);
		host.phases.set("fx", { phase: "gone" });

		const [notice] = await beginStep(interp, hooks);

		expect(notice?.text).toBe(
			'(mcp/observe "fx" :gone nil)\n=> fx went from :ready to :gone',
		);
		interp.dispose();
	}, 30_000);

	it("returns a handler's error as its answer, and the REPL carries on", async () => {
		const { host, interp, hooks } = await loaded();
		runSync(interp, '(mcp/on-change "fx" (lambda (n o w r) (error "nope")))');
		host.phases.set("fx", { phase: "gone" });

		const [notice] = await beginStep(interp, hooks);

		expect(notice?.text).toMatch(
			/^\(mcp\/observe "fx" :gone nil\)\n=> the on-change handler for fx failed: .*nope/,
		);
		expect(interp.hasGlobal(newSym("fx/echo"))).toBe(false);
		expect(runSync(interp, "(+ 1 2)")).toBe(3n);
		interp.dispose();
	}, 30_000);
});

describe("observing a phase in the language", () => {
	it("is silent the first time a server is seen ready, and on a phase it already has", () => {
		const { interp } = fresh();

		expect(runSync(interp, '(mcp/observe "other" :ready nil)')).toBeNull();
		expect(runSync(interp, '(mcp/phase "other")')).toBe(
			newLispKeyword("ready"),
		);
		expect(
			runSync(interp, '(mcp/observe "other" :ready "ignored")'),
		).toBeNull();
		interp.dispose();
	});

	it("hands the reason to the handler and forgets a server it unloads", () => {
		const { interp } = fresh();
		runSync(interp, '(mcp/observe "other" :ready nil)');
		runSync(interp, '(mcp/on-change "other" (lambda (n o w r) r))');

		expect(runSync(interp, '(mcp/observe "other" :failed "first")')).toBe(
			"first",
		);
		expect(runSync(interp, '(mcp/phase "other")')).toBeNull();
		interp.dispose();
	});
});
