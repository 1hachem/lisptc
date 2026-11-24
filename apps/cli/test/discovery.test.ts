import { MemoryRepl } from "@repo/repl/repl";
import { describe, expect, it } from "vitest";
import { sessionExtensions } from "../src/extensions.ts";

function repl(): MemoryRepl {
	return new MemoryRepl({ extensions: sessionExtensions() });
}

describe("a discovery call is read, not described", () => {
	it("prints the toolkit listing the same way", async () => {
		const out = await repl().eval("(list-toolkit)");
		expect(out).toContain("playwright");
		expect(out).not.toContain("list-toolkit-1:");
	});

	it("mints no name, since the answer was the point", async () => {
		const r = repl();
		await r.eval('(search-mcps "browser")');
		expect(await r.eval("(dump)")).not.toContain("search-mcps-1");
	});
});
