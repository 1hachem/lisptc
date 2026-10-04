import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bufferTransport } from "../src/channels-host.ts";
import { EvalException, StepHold } from "../src/errors.ts";
import { type Interp, runSync } from "../src/lisp.ts";
import { str } from "../src/print.ts";
import { note } from "../src/topics.ts";
import { freshInterp } from "./helpers.ts";

function holding(): Interp {
	const interp = freshInterp();
	interp.def("hold", 1, "(hold x)", "", z.tuple([z.any()]), ([x]) => {
		throw new StepHold(`holding ${str(x)}`);
	});
	return interp;
}

function thrownBy(interp: Interp, code: string): unknown {
	try {
		runSync(interp, code);
	} catch (ex) {
		return ex;
	}
	throw new Error(`${code} did not throw`);
}

describe("a held step", () => {
	it("stops the remaining top-level forms and emits a held note", () => {
		const interp = holding();
		const buffer = bufferTransport();
		const detach = interp.channels.pipe(buffer);
		let thrown: unknown;
		try {
			thrown = thrownBy(interp, "(setq n 1) (hold 2) (setq n 3)");
		} finally {
			detach();
		}
		expect(thrown).toBeInstanceOf(StepHold);
		expect(str(runSync(interp, "n"))).toBe("1");
		expect(buffer.collect(note)).toEqual([{ kind: "held", text: "holding 2" }]);
	});

	it("is not caught by a lisp try", () => {
		const interp = holding();
		const thrown = thrownBy(
			interp,
			"(setq caught nil) (try (hold 1) (catch (e) (setq caught t)))",
		);
		expect(thrown).toBeInstanceOf(StepHold);
		expect(str(runSync(interp, "caught"))).toBe("nil");
	});

	it("passes through apply and mapcar unwrapped", () => {
		for (const code of ["(apply hold '(1))", "(mapcar hold '(1 2))"]) {
			const thrown = thrownBy(holding(), code);
			expect(thrown).toBeInstanceOf(StepHold);
			expect(thrown).not.toBeInstanceOf(EvalException);
		}
	});
});
