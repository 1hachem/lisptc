import { memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { VolatileStore } from "@repo/memory-extension/ports";
import { permissionsExtension } from "@repo/permissions-extension";
import { textPermissionsHost } from "@repo/permissions-extension/host";
import { MemoryRepl } from "@repo/repl/repl";
import { describe, expect, it } from "vitest";

function replWith(config: string): MemoryRepl {
	const memory = memoryExtension({ ...memoryHost, store: new VolatileStore() });
	const permissions = permissionsExtension({
		...textPermissionsHost(config),
		asks: memory.asks,
	});
	return new MemoryRepl({ extensions: [permissions, memory] });
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
		const { open: requests } = asked.annotations.output.asks as {
			open: { title: string }[];
		};
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
});
