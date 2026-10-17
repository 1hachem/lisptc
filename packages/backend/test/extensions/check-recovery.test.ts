import { lintExtension } from "@repo/lint-extension";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { recoveryExtension } from "@repo/recovery-extension";
import { recoveryHost } from "@repo/recovery-extension/host";
import { describe, expect, it } from "vitest";
import { agentRepl } from "./helpers.ts";

function checked() {
	return agentRepl([
		proseExtension(proseHost),
		recoveryExtension(recoveryHost),
		lintExtension(),
	]);
}

describe("a step the check stops, repaired by an edit", () => {
	it("pushes the argument a call was missing, and admits the result", async () => {
		const repl = checked();
		await repl.eval("(defun total (a b) (+ a b))");
		const stopped = await repl.admit("(echo (total 1))");
		expect(stopped.rejected).toContain("total: expected 2 arguments, got 1");
		expect(stopped.rejected).toContain("(push-arg f value)");
		expect(await repl.admit("(push-arg total 2)")).toEqual({
			code: "(echo (total 1 2))",
			because: "edited the code the check stopped",
			from: expect.any(String),
		});
	});

	it("closes what did not read, with prose around the edit", async () => {
		const repl = checked();
		const stopped = await repl.admit("(echo (+ 1 2)");
		expect(stopped.rejected).toContain("line 1: unexpected end of input");
		expect((await repl.evalOutput("(echo rejected)")).user).toContain(
			"(echo (+ 1 2)",
		);
		expect(await repl.admit("Closing it.\n(close-parens)")).toEqual({
			code: "(echo (+ 1 2))",
			because: "edited the code the check stopped",
			from: expect.any(String),
		});
	});

	it("holds an edit that is still wrong as the new rejected code", async () => {
		const repl = checked();
		await repl.admit("(echo (car)");
		const again = await repl.admit("(close-parens)");
		expect(again.rejected).toContain("car: expected 1 argument, got 0");
		expect((await repl.evalOutput("(echo rejected)")).user).toContain(
			"(echo (car))",
		);
	});

	it("admits prose whose open parenthesis opens no form", async () => {
		expect(await checked().admit("that went badly :(")).toEqual({
			code: "that went badly :(",
		});
	});
});
