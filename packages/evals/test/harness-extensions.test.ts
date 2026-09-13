import { systemPromptFor } from "@repo/ai";
import { promisesExtension } from "@repo/interpreter/promises";
import { proseExtension } from "@repo/interpreter/prose";
import { describe, expect, test } from "vitest";
import { tracedRepl } from "../src/harness.ts";

describe("a case that lists its own extensions", () => {
	test("gets those and the recorder, and nothing else", async () => {
		const { repl } = tracedRepl({
			extensions: ({ mcp, compaction }) => [
				promisesExtension(),
				mcp,
				compaction,
				proseExtension(),
			],
		});

		expect(await repl.eval("(list-toolkit)")).toContain("playwright");
		expect(await repl.eval('(secret "REPL_X")')).toContain("undefined: secret");
		expect(await repl.eval('(llm/complete "hi")')).toContain(
			"undefined: llm/complete",
		);
	});

	test("is prompted with those sections alone", () => {
		const { repl } = tracedRepl({
			extensions: ({ compaction }) => [compaction],
		});
		const prompt = systemPromptFor(repl.interp);

		expect(prompt).toMatch(/EXTRACT, THEN ECHO/);
		expect(prompt).not.toMatch(/MCP SERVERS/);
		expect(prompt).not.toMatch(/LANGUAGE MODELS/);
	});

	test("speaks the whole language when it says nothing", async () => {
		const { repl } = tracedRepl();

		expect(await repl.eval("(doc 'llm/complete)")).toContain("(llm/complete");
		expect(systemPromptFor(repl.interp)).toMatch(/MCP SERVERS/);
	});
});
