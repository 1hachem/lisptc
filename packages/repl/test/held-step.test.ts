import { StepHold } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type { InterpExtension } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { agentRepl, memoryRepl } from "./helpers.ts";

const REASON = "the call waits for the user";

function holding(): InterpExtension {
	return (interp: Interp): void => {
		interp.defineGlobal(
			newSym("hold"),
			interp.makeBuiltIn("hold", 0, () => {
				throw new StepHold(REASON);
			}),
		);
	};
}

describe("a held step", () => {
	it("is reported as held rather than failed, with the reason in the model text", async () => {
		const r = memoryRepl([holding()]);
		const out = await r.evalOutput('(echo "before") (hold) (echo "after")');
		expect(out.failed).toBe(false);
		expect(out.held).toBe(true);
		expect(out.model).toContain(`held: ${REASON}`);
		expect(out.user).toContain("before");
		expect(out.user).not.toContain("after");
	});

	it("leaves an ordinary step unheld", async () => {
		const out = await memoryRepl([holding()]).evalOutput("(+ 1 2)");
		expect(out.held).toBe(false);
		expect(out.failed).toBe(false);
	});

	it("ends the agent's turn", async () => {
		const r = agentRepl([holding()]);
		const out = await r.evalOutput("(hold)");
		expect(out.failed).toBe(false);
		expect(out.held).toBe(true);
		expect(r.takeFinished()).toBe(true);
	});
});
