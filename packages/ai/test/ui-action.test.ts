import { newSym } from "@repo/interpreter/objects";
import { MemoryImageStore } from "@repo/repl/image-store";
import { describe, expect, test } from "vitest";
import { runUiAction } from "../src/ui-action.ts";
import { extension, testRepl } from "./helpers.ts";

function clicking(seen: unknown[]) {
	return extension((hooks) =>
		hooks.invoke.use(async (ctx) => {
			seen.push(ctx.interp.getGlobal(newSym("clicked")));
		}),
	);
}

describe("a ui action", () => {
	test("resumes a chat's repl from its checkpoint after a restart", async () => {
		const images = new MemoryImageStore();
		const before = testRepl([], images);
		await before.evalOutput("(setq clicked 7)");
		await new Promise((resolve) => setTimeout(resolve, 0));

		const seen: unknown[] = [];
		const restarted = {
			async repl() {
				const repl = testRepl([clicking(seen)], images);
				await repl.resume();
				return repl;
			},
		};
		const result = await runUiAction(restarted, "chat", "a1", {});

		expect(result.error).toBe(false);
		expect(seen).toEqual([7n]);
	});
});
