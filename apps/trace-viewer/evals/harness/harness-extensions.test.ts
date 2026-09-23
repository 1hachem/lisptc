import { systemPromptFor } from "@repo/ai";
import { mockedMcpExtension } from "@repo/checks/mocks";
import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { describe, expect, test } from "vitest";
import { tracedRepl } from "./harness.ts";

describe("a case that lists its own extensions", () => {
	test("gets those and the recorder, and nothing else", async () => {
		const { repl } = tracedRepl({
			extensions: () => [
				promisesExtension(promisesHost),
				mockedMcpExtension(),
				compactionExtension(compactionHost),
				proseExtension(proseHost),
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
			extensions: () => [compactionExtension(compactionHost)],
		});
		const prompt = systemPromptFor(repl.interp);

		expect(prompt).toMatch(/EXTRACT, THEN ECHO/);
		expect(prompt).not.toMatch(/MCP SERVERS/);
		expect(prompt).not.toMatch(/LANGUAGE MODELS/);
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
			extensions: () => [promisesExtension(promisesHost), mockedMcpExtension()],
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
