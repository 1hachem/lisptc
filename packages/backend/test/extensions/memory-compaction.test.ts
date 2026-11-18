import { Compactor, compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { describe, expect, it } from "vitest";
import { memoryRepl } from "./helpers.ts";

describe("memory under compaction", () => {
	it("declares the built-in memories inside a step without reporting them", async () => {
		const r = memoryRepl([
			compactionExtension(compactionHost, { compactor: new Compactor(50) }),
			memoryExtension(memoryHost),
		]);
		expect(await r.eval("(+ 1 2)")).toBe("+-1: 3\n");
		expect(await r.eval("(length (memory/builtins))")).toMatch(
			/^length-1: \d+\n$/,
		);
	});
});
