import { bankOf } from "@repo/interpreter/memory";
import { describe, expect, it } from "vitest";
import { agentExtensions, getThreadRepl } from "../src/repl-store.ts";

describe("the REPL every agent host builds", () => {
	it("carries a memory, so the API remembers across turns", async () => {
		const repl = getThreadRepl("thread-a");

		expect(repl.memories).toBeDefined();
		expect(await repl.eval('(memory/remember "k" "a note")')).toContain("k");
		expect(await repl.eval('(memory/recall "note")')).toContain("a note");
	});

	it("hands the same thread the same memories on a later turn", async () => {
		await getThreadRepl("thread-b").eval('(memory/remember "k" "still here")');

		expect(
			await getThreadRepl("thread-b").eval('(memory/recall "k")'),
		).toContain("still here");
	});

	it("keeps one thread's memories out of another's", async () => {
		await getThreadRepl("thread-c").eval('(memory/remember "secret" "mine")');

		expect(
			await getThreadRepl("thread-d").eval('(memory/recall "secret")'),
		).not.toContain("mine");
	});

	it("gives an unscoped roster a bank of its own", () => {
		const banks = agentExtensions().map(bankOf).filter(Boolean);

		expect(banks).toHaveLength(1);
	});
});
