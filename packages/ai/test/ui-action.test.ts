import { newSym } from "@repo/interpreter/objects";
import { viewKind } from "@repo/journal-catalog/view";
import { MemoryImageStore } from "@repo/repl/image-store";
import { describe, expect, test } from "vitest";
import { runUiAction } from "../src/ui-action.ts";
import { extension, testRepl } from "./helpers.ts";

const clicking = extension((hooks) =>
	hooks.invoke.use(async (ctx) => {
		ctx.interp.journal.write(viewKind, {
			viewId: String(ctx.interp.getGlobal(newSym("clicked"))),
		});
	}),
);

describe("a ui action", () => {
	test("resumes a chat's repl from its checkpoint after a restart", async () => {
		const images = new MemoryImageStore();
		const before = testRepl([], images);
		await before.evalOutput("(setq clicked 7)");
		await new Promise((resolve) => setTimeout(resolve, 0));

		const restarted = {
			async repl() {
				const repl = testRepl([clicking], images);
				await repl.resume();
				return repl;
			},
		};
		const result = await runUiAction(restarted, "chat", "a1", {});

		expect(result.error).toBe(false);
		expect(result.entries).toEqual([
			expect.objectContaining({ value: { viewId: "7" } }),
		]);
	});

	test("hands what the action recorded back apart from the reply", async () => {
		const rendering = extension((hooks) => {
			hooks.invoke.use(async (ctx) => {
				ctx.interp.journal.write(viewKind, { viewId: "v1" });
			});
		});
		const repl = testRepl([rendering]);
		const result = await runUiAction(
			{ repl: async () => repl },
			"chat",
			"a1",
			{},
		);

		expect(result).not.toHaveProperty("ui");
		expect(result.entries).toEqual([
			expect.objectContaining({ kind: "ui", value: { viewId: "v1" } }),
		]);
	});
});
