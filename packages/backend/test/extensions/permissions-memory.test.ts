import { asksKind } from "@repo/journal-catalog/asks";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { VolatileStore } from "@repo/memory-extension/ports";
import { permissionsExtension } from "@repo/permissions-extension";
import { textPermissionsHost } from "@repo/permissions-extension/host";
import { MemoryImageStore } from "@repo/repl/image-store";
import { AgentRepl, MemoryRepl } from "@repo/repl/repl";
import { view } from "@repo/shared/journal";
import { describe, expect, it } from "vitest";

function replWith(config: string): MemoryRepl {
	const memory = memoryExtension({ ...memoryHost, store: new VolatileStore() });
	const permissions = permissionsExtension({
		...textPermissionsHost(config),
		asks: memory.asks,
	});
	return new MemoryRepl({ extensions: [permissions, memory] });
}

function resumable(store: VolatileStore, images: MemoryImageStore): AgentRepl {
	const memory = memoryExtension({ ...memoryHost, store });
	const permissions = permissionsExtension({
		...textPermissionsHost(""),
		asks: memory.asks,
	});
	return new AgentRepl({ extensions: [permissions, memory], images });
}

async function printed(repl: MemoryRepl, code: string): Promise<string> {
	return (await repl.evalOutput(`(echo ${code})`)).user;
}

const REMEMBER = '(memory/remember "k" "a note")';

describe("permissions over the memory extension", () => {
	it("holds forget-all for the user under a config that never names it", async () => {
		const repl = replWith("");
		await repl.eval(REMEMBER);
		const asked = await repl.evalOutput("(memory/forget-all)");
		expect(asked.held).toBe(true);
		const requests = view(asked.entries, asksKind).open ?? [];
		expect(requests.map((r) => r.title)).toEqual(["memory/forget-all"]);
		expect(await printed(repl, '(memory/recall "note")')).toContain("a note");
	});

	it("runs forget-all at once when a rule allows it by name", async () => {
		const repl = replWith("(permission/allow memory/forget-all)");
		await repl.eval(REMEMBER);
		expect(await printed(repl, "(memory/forget-all)")).toContain("1");
	});

	it("leaves the rest of memory to the config", async () => {
		const repl = replWith("");
		expect(await printed(repl, REMEMBER)).toContain("k");
	});

	it("lets a session resumed from its image answer a held forget-all, then run it on the next step", async () => {
		const store = new VolatileStore();
		const images = new MemoryImageStore();
		const first = resumable(store, images);
		await first.eval(REMEMBER);
		const asked = await first.evalOutput("(memory/forget-all)");
		const [ask] = view(asked.entries, asksKind).open ?? [];
		await first.resume();

		const resumed = resumable(store, images);
		await resumed.resume();
		const decided = await resumed.invokeUi("permissions/decide", {
			id: ask?.id,
			approved: true,
			scope: "once",
		});
		expect(decided.failed).toBe(false);
		expect(decided.notes.map((said) => said.content).join("\n")).toContain(
			"run it again exactly as before",
		);
		expect(await printed(resumed, "(memory/forget-all)")).toContain("1");
	});
});
