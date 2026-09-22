import {
	driveAsync,
	Interp,
	prelude,
	runAsync,
	runSync,
} from "@repo/interpreter/lisp";
import {
	MemoryBank,
	memoryExtension,
	VolatileStore,
} from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { describe, expect, it } from "vitest";

function fixture(prose = proseExtension()): {
	interp: Interp;
	bank: MemoryBank;
} {
	const bank = new MemoryBank(new VolatileStore());
	const interp = new Interp({
		extensions: [memoryExtension(memoryHost, { bank }), prose],
	});
	runSync(interp, prelude);
	return { interp, bank };
}

async function step(
	interp: Interp,
	bank: MemoryBank,
	code: string,
): Promise<string> {
	const before = await driveAsync(bank.beginStep(code, interp));
	await runAsync(interp, code);
	return before.value + (await driveAsync(bank.endStep())).value;
}

describe("memory and prose", () => {
	it("keeps an error trigger quiet when prose excuses the form", async () => {
		const { interp, bank } = fixture(
			proseExtension({ ...proseHost, classify: () => "read as prose" }),
		);
		await runAsync(
			interp,
			`(memory/remember "voids" "define it first" :on '(error "undefined"))`,
		);
		expect(await step(interp, bank, '(deploy "the thing")')).not.toContain(
			"voids",
		);
	});

	it("fires prose triggers around forms", async () => {
		const { interp, bank } = fixture();
		await runAsync(
			interp,
			`(memory/remember "todos" "finish it" :on '(prose "TODO"))`,
		);
		expect(await step(interp, bank, "TODO check this\n(+ 1 1)")).toContain(
			"todos: finish it",
		);
	});

	it("combines prose text patterns", async () => {
		const { interp, bank } = fixture();
		await runAsync(
			interp,
			`(memory/remember "u" "note" :on '(prose (any-of "deploy" "ship")))`,
		);
		expect(await step(interp, bank, "ship it now\n(+ 1 1)")).toContain(
			"u: note",
		);
		expect(await step(interp, bank, "nothing here\n(+ 1 1)")).not.toContain(
			"u: note",
		);
	});
});
