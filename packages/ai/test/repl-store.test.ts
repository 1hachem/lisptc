import { bankOf, memorySlot } from "@repo/interpreter/memory";
import { describe, expect, it } from "vitest";
import { agentExtensions, getThreadRepl } from "../src/repl-store.ts";

describe("the REPL every agent host builds", () => {
	it("carries a memory, so the API remembers across turns", async () => {
		const repl = getThreadRepl("thread-a");

		expect(repl.hooks.filled(memorySlot)).toBeDefined();
		expect(await repl.eval('(memory/remember "k" "a note")')).toContain("k");
		expect(await repl.eval('(memory/recall "note")')).toContain("a note");
	});

	it("hands the same thread the same memories on a later turn", async () => {
		await getThreadRepl("thread-b").eval('(memory/remember "k" "still here")');

		expect(
			await getThreadRepl("thread-b").eval('(memory/recall "k")'),
		).toContain("still here");
	});

	it("carries what one conversation learned into the next", async () => {
		await getThreadRepl("thread-c", "someone").eval(
			'(memory/remember "k" "learned in the first conversation")',
		);

		expect(
			await getThreadRepl("a-brand-new-thread", "someone").eval(
				'(memory/recall "k")',
			),
		).toContain("learned in the first conversation");
	});

	it("keeps one person's memories out of another's", async () => {
		await getThreadRepl("thread-d", "someone").eval(
			'(memory/remember "secret" "mine")',
		);

		expect(
			await getThreadRepl("thread-e", "someone-else").eval(
				'(memory/recall "secret")',
			),
		).not.toContain("mine");
	});

	it("gives a caller with no identity a shared memory rather than none", async () => {
		await getThreadRepl("thread-f").eval('(memory/remember "k" "anonymous")');

		expect(
			await getThreadRepl("thread-g").eval('(memory/recall "k")'),
		).toContain("anonymous");
	});

	it("gives an unscoped roster a bank of its own", () => {
		const banks = agentExtensions().map(bankOf).filter(Boolean);

		expect(banks).toHaveLength(1);
	});
});
