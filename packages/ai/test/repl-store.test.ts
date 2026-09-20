import { memorySlot } from "@repo/memory-extension";
import type { AgentRepl } from "@repo/repl/repl";
import { describe, expect, it } from "vitest";
import { ReplStore } from "../src/repl-store.ts";
import { testRepl, testRepls } from "./helpers.ts";

describe("the store a host keeps its threads in", () => {
	it("hands the same thread the same repl on a later turn", async () => {
		const repls = testRepls();
		await (await repls.get("thread-a")).eval('(memory/remember "k" "kept")');

		expect(
			await (await repls.get("thread-a")).eval('(memory/recall "k")'),
		).toContain("kept");
	});

	it("gives another thread a repl of its own", async () => {
		const repls = testRepls();
		await (await repls.get("thread-b")).eval("(setq x 41)");

		expect(await (await repls.get("thread-c")).eval("(echo x)")).toContain(
			"void variable: x",
		);
	});

	it("opens a thread once, however many turns race for it", async () => {
		let opened = 0;
		const repls = new ReplStore(async (): Promise<AgentRepl> => {
			opened += 1;
			await Promise.resolve();
			return testRepl();
		});

		const [one, another] = await Promise.all([
			repls.get("thread-d"),
			repls.get("thread-d"),
		]);

		expect(opened).toBe(1);
		expect(one).toBe(another);
	});

	it("does not build a repl for a thread nobody has opened", () => {
		expect(testRepls().peek("thread-e")).toBeUndefined();
	});

	it("drops the thread it heard from longest ago", async () => {
		const repls = new ReplStore(() => testRepl(), 2);
		await repls.get("thread-f");
		await repls.get("thread-g");
		await repls.get("thread-h");

		expect(repls.peek("thread-f")).toBeUndefined();
		expect(repls.peek("thread-g")).toBeDefined();
	});

	it("carries a memory, so a thread remembers across turns", async () => {
		const repl = await testRepls().get("thread-i");

		expect(repl.hooks.filled(memorySlot)).toBeDefined();
		expect(await repl.eval('(memory/remember "k" "a note")')).toContain("k");
		expect(await repl.eval('(memory/recall "note")')).toContain("a note");
	});

	it("carries what one conversation learned into the next", async () => {
		const repls = testRepls("someone");
		await (await repls.get("thread-j")).eval(
			'(memory/remember "k" "learned in the first conversation")',
		);

		expect(
			await (await repls.get("a-brand-new-thread")).eval('(memory/recall "k")'),
		).toContain("learned in the first conversation");
	});

	it("keeps one person's memories out of another's", async () => {
		await (await testRepls("someone").get("thread-k")).eval(
			'(memory/remember "secret" "mine")',
		);

		expect(
			await (await testRepls("someone-else").get("thread-l")).eval(
				'(memory/recall "secret")',
			),
		).not.toContain("mine");
	});

	it("gives an unscoped roster a bank of its own", () => {
		expect(testRepl().hooks.filled(memorySlot)).not.toBe(
			testRepl().hooks.filled(memorySlot),
		);
	});
});
