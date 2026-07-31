import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INTERPRETER_SOURCE, INTERPRETER_SOURCES } from "../src/source.ts";

const SRC_DIR = new URL("../src/", import.meta.url);

// `INTERPRETER_SOURCE` is embedded verbatim into the pi agent's system prompt.
// If a new file lands in `src/` but is not added to `source.ts`'s `FILES`
// list, the prompt silently drifts from the real interpreter — the LLM would
// be programming against an incomplete spec. These tests fail loudly the
// moment that happens, so adding a source file forces updating the prompt.
describe("interpreter source embedding", () => {
	// Every real source file (minus this test's own concerns) must be embedded.
	// `source.ts` itself is excluded: it only reads the others, so embedding it
	// would be circular noise, not part of the language definition.
	const onDisk = readdirSync(SRC_DIR)
		.filter((f) => f.endsWith(".ts") || f.endsWith(".gbnf"))
		.filter((f) => f !== "source.ts")
		.sort();

	it("embeds every source file in src/", () => {
		expect(Object.keys(INTERPRETER_SOURCES).sort()).toEqual(onDisk);
	});

	it.each(onDisk)("includes %s in the prompt markdown", (file) => {
		expect(INTERPRETER_SOURCE).toContain(`### src/${file}`);
		// The embedded copy must match the file's real contents, not a stale
		// snapshot.
		expect(INTERPRETER_SOURCE).toContain(INTERPRETER_SOURCES[file]);
	});
});
