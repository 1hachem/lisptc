import { ReplStore } from "@repo/ai/repl-store";
import { memorySlot } from "@repo/memory-extension";
import type { AgentRepl } from "@repo/repl/repl";
import { describe, expect, it } from "vitest";
import { agentRepl, modelFacing } from "./helpers.ts";

const scoped = (scope?: string): AgentRepl =>
	agentRepl(modelFacing(undefined, scope));

const repls = (scope?: string): ReplStore => new ReplStore(() => scoped(scope));

describe("what a thread's repl remembers", () => {
	it("carries a memory, so a thread remembers across turns", async () => {
		const repl = await repls().get("thread-i");

		expect(repl.hooks.filled(memorySlot)).toBeDefined();
		expect(await repl.eval('(memory/remember "k" "a note")')).toContain("k");
		expect(await repl.eval('(memory/recall "note")')).toContain("a note");
	});

	it("keeps one thread's definitions out of another's", async () => {
		const store = repls();
		await (await store.get("thread-a")).eval('(memory/remember "k" "kept")');

		expect(
			await (await store.get("thread-a")).eval('(memory/recall "k")'),
		).toContain("kept");
	});

	it("carries what one conversation learned into the next", async () => {
		const store = repls("someone");
		await (await store.get("thread-j")).eval(
			'(memory/remember "k" "learned in the first conversation")',
		);

		expect(
			await (await store.get("a-brand-new-thread")).eval('(memory/recall "k")'),
		).toContain("learned in the first conversation");
	});

	it("keeps one person's memories out of another's", async () => {
		await (await repls("someone").get("thread-k")).eval(
			'(memory/remember "secret" "mine")',
		);

		expect(
			await (await repls("someone-else").get("thread-l")).eval(
				'(memory/recall "secret")',
			),
		).not.toContain("mine");
	});

	it("gives an unscoped roster a bank of its own", () => {
		expect(scoped().hooks.filled(memorySlot)).not.toBe(
			scoped().hooks.filled(memorySlot),
		);
	});
});
