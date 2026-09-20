import { memorySlot } from "@repo/memory-extension";
import type { AgentRepl } from "@repo/repl/repl";
import { describe, expect, it } from "vitest";
import { agentRepl, modelFacing } from "./helpers.ts";

const scoped = (scope?: string): AgentRepl =>
	agentRepl(modelFacing(undefined, scope));

describe("what a repl remembers, and for whom", () => {
	it("carries a memory, so one repl remembers across turns", async () => {
		const repl = scoped();

		expect(repl.hooks.filled(memorySlot)).toBeDefined();
		expect(await repl.eval('(memory/remember "k" "a note")')).toContain("k");
		expect(await repl.eval('(memory/recall "note")')).toContain("a note");
	});

	it("carries what one conversation learned into the next", async () => {
		await scoped("someone").eval(
			'(memory/remember "k" "learned in the first conversation")',
		);

		expect(await scoped("someone").eval('(memory/recall "k")')).toContain(
			"learned in the first conversation",
		);
	});

	it("keeps one person's memories out of another's", async () => {
		await scoped("someone").eval('(memory/remember "secret" "mine")');

		expect(
			await scoped("someone-else").eval('(memory/recall "secret")'),
		).not.toContain("mine");
	});

	it("gives an unscoped roster a bank of its own", () => {
		expect(scoped().hooks.filled(memorySlot)).not.toBe(
			scoped().hooks.filled(memorySlot),
		);
	});
});
