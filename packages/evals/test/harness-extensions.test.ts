import { systemPromptFor } from "@repo/ai";
import { compactionExtension } from "@repo/interpreter/compaction";
import { promisesExtension } from "@repo/interpreter/promises";
import { proseExtension } from "@repo/interpreter/prose";
import { describe, expect, test } from "vitest";
import { tracedRepl } from "../src/harness.ts";
import { mockedMcpExtension } from "../src/mocks.ts";

describe("a case that lists its own extensions", () => {
	test("gets those and the recorder, and nothing else", async () => {
		const { repl } = tracedRepl({
			extensions: () => [
				promisesExtension(),
				mockedMcpExtension(),
				compactionExtension(),
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
			extensions: () => [compactionExtension()],
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

	test("records the calls of the mock it was handed", async () => {
		const { repl, trace } = tracedRepl({
			mocks: {
				servers: {
					playwright: {
						tools: [{ name: "browser_snapshot" }],
						calls: { browser_snapshot: { heading: "hyko" } },
					},
				},
			},
			extensions: () => [promisesExtension(), mockedMcpExtension()],
		});

		await repl.eval('(await (load-mcp "playwright"))');
		await repl.eval("(playwright/browser_snapshot)");

		expect(trace.events.filter((e) => e.kind === "tool")).toHaveLength(1);
	});
});

describe("a mock built outside a run", () => {
	test("says so instead of binding a stale recorder", () => {
		expect(() => mockedMcpExtension()).toThrow(
			/only available inside an eval case/,
		);
	});
});
