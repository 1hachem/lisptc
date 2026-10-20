import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import { output } from "@repo/interpreter/topics";
import { describe, expect, it } from "vitest";
import { memoryRepl } from "./helpers.ts";

function emittingAfterTheStep(interp: Interp): void {
	interp.defineGlobal(
		newSym("later"),
		interp.makeBuiltIn("later", 0, () => {
			setTimeout(() =>
				output.emit(interp.channels, {
					user: "signed out\n",
					model: "signed out\n",
				}),
			);
			return 0;
		}),
	);
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe("what is emitted between steps", () => {
	it("reaches the next step on every lane", async () => {
		const repl = memoryRepl([emittingAfterTheStep]);
		const first = await repl.evalOutput("(later)");
		await tick();
		const next = await repl.evalOutput("(+ 1 1)");

		expect(first.user).not.toContain("signed out");
		expect(next.user).toContain("signed out");
		expect(next.model).toContain("signed out");
	});

	it("reaches only the one step after it", async () => {
		const repl = memoryRepl([emittingAfterTheStep]);
		await repl.evalOutput("(later)");
		await tick();
		await repl.evalOutput("(+ 1 1)");
		const after = await repl.evalOutput("(+ 2 2)");

		expect(after.user).not.toContain("signed out");
	});
});
