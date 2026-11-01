import { note, output } from "@repo/interpreter/topics";
import { describe, expect, it } from "vitest";
import { agentRepl, extension } from "./helpers.ts";

const admittingLoudly = extension((hooks) =>
	hooks.admit.use((interp, code, next) => {
		note.emit(interp.channels, {
			model: { kind: "skipped", text: "skipped while admitting" },
		});
		output.emit(interp.channels, {
			user: "said while admitting\n",
			model: "said while admitting\n",
		});
		return next(interp, code);
	}),
);

describe("what admitting a step emits", () => {
	it("keeps its notes out of the next step", async () => {
		const repl = agentRepl([admittingLoudly]);
		await repl.evalOutput("(+ 1 1)");
		await repl.admit("(+ 2 2)");
		const next = await repl.evalOutput("(+ 3 3)");

		expect(next.model).not.toContain("skipped while admitting");
	});

	it("still carries its output to the next step", async () => {
		const repl = agentRepl([admittingLoudly]);
		await repl.evalOutput("(+ 1 1)");
		await repl.admit("(+ 2 2)");
		const next = await repl.evalOutput("(+ 3 3)");

		expect(next.model).toContain("said while admitting");
	});
});
