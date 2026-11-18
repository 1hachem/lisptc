import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { describe, expect, test } from "vitest";
import { tracedRepl } from "./harness.ts";
import { mockedMcpExtension } from "./mocks.ts";

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
		expect(await repl.eval('(write "hi")')).toContain("undefined: write");
	});
});

describe("a mock built outside a run", () => {
	test("refuses to be built instead of binding a stale recorder", () => {
		expect(() => mockedMcpExtension()).toThrow();
	});
});
