import { MemoryBank, memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { VolatileStore } from "@repo/memory-extension/ports";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { describe, expect, it } from "vitest";
import { memoryRepl } from "./helpers.ts";

function repl(prose = proseExtension(proseHost)) {
	const r = memoryRepl([
		memoryExtension(memoryHost, { bank: new MemoryBank(new VolatileStore()) }),
		prose,
	]);
	const fired = async (code: string) =>
		[(await r.evalOutput(code)).emitted].flat().join("\n");
	return { r, fired };
}

describe("memory and prose", () => {
	it("keeps an error trigger quiet when prose excuses the form", async () => {
		const { r, fired } = repl(
			proseExtension({
				...proseHost,
				classifiers: [() => ({ reason: "read as prose" })],
			}),
		);
		await r.eval(
			`(memory/remember "voids" "define it first" :on '(error "undefined"))`,
		);
		expect(await fired('(deploy "the thing")')).not.toContain("voids");
	});

	it("fires prose triggers around forms", async () => {
		const { r, fired } = repl();
		await r.eval(`(memory/remember "todos" "finish it" :on '(prose "TODO"))`);
		expect(await fired("TODO check this\n(+ 1 1)")).toContain(
			"todos: finish it",
		);
	});

	it("combines prose text patterns", async () => {
		const { r, fired } = repl();
		await r.eval(
			`(memory/remember "u" "note" :on '(prose (any-of "deploy" "ship")))`,
		);
		expect(await fired("ship it now\n(+ 1 1)")).toContain("u: note");
		expect(await fired("nothing here\n(+ 1 1)")).not.toContain("u: note");
	});
});
