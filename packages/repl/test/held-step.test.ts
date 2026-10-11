import type { Hold } from "@repo/interpreter/drive";
import { EvalException, StepHold } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
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

function parking(): InterpExtension {
	let waiting: Hold | undefined;
	return Object.assign(
		(interp: Interp): void => {
			interp.defineGlobal(
				newSym("guarded"),
				interp.makeBuiltIn("guarded", 0, () => "ran"),
			);
			interp.hooks.call.use((i, name, args, next) => {
				if (name !== "guarded") return next(i, name, args);
				const hold = i.hold(REASON);
				if (hold === undefined) throw new StepHold(REASON);
				waiting = hold;
				return hold.until.then(() => next(i, name, args));
			});
		},
		{
			session(hooks: SessionHooks): void {
				hooks.invoke.use(async (ctx, next) => {
					if (ctx.action === "release") waiting?.release();
					else if (ctx.action === "refuse")
						waiting?.refuse(new EvalException("refused", null, false));
					else return next(ctx);
				});
			},
		},
	);
}

const PARKED = '(echo "before") (guarded) (echo "after")';

describe("a parked step", () => {
	it("ends at the call, then carries on from it once released", async () => {
		const r = memoryRepl([parking()]);
		const out = await r.evalOutput(PARKED);
		expect(out.held).toBe(true);
		expect(out.failed).toBe(false);
		expect(out.user).toContain("before");
		expect(out.user).not.toContain("after");
		const resumed = await r.invokeUi("release");
		expect(resumed.failed).toBe(false);
		expect(resumed.held).toBe(false);
		expect(resumed.user).toContain("after");
		expect(resumed.user).not.toContain("before");
		expect(resumed.message).toContain("carried on");
	});

	it("reports a refused call in the message, without failing the decision", async () => {
		const r = memoryRepl([parking()]);
		await r.evalOutput(PARKED);
		const resumed = await r.invokeUi("refuse");
		expect(resumed.failed).toBe(false);
		expect(resumed.user).not.toContain("after");
		expect(resumed.message).toContain("refused");
	});

	it("runs other steps while one waits", async () => {
		const r = memoryRepl([parking()]);
		await r.evalOutput(PARKED);
		const between = await r.evalOutput('(echo "between")');
		expect(between.held).toBe(false);
		expect(between.user).toContain("between");
		expect((await r.invokeUi("release")).user).toContain("after");
	});

	it("parks again when the carried step reaches another hold", async () => {
		const r = memoryRepl([parking()]);
		await r.evalOutput('(guarded) (echo "middle") (guarded) (echo "end")');
		const first = await r.invokeUi("release");
		expect(first.held).toBe(true);
		expect(first.user).toContain("middle");
		const second = await r.invokeUi("release");
		expect(second.held).toBe(false);
		expect(second.user).toContain("end");
	});
});

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
