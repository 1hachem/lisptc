import { bufferTransport } from "@repo/interpreter/channels-host";
import { effect } from "@repo/interpreter/effects";
import { StepHold } from "@repo/interpreter/errors";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { agentsExtension } from "../src/agents.ts";
import { agentsHostFor } from "../src/agents-host.ts";

function run(code: string) {
	const interp = new Interp({ extensions: [agentsExtension(agentsHostFor())] });
	runSync(interp, prelude);
	interp.def("hold", 0, "(hold)", "", z.tuple([]), () => {
		throw new StepHold("waiting on the user");
	});
	const buffer = bufferTransport();
	interp.channels.pipe(buffer);
	try {
		return {
			value: str(runSync(interp, code)),
			effects: buffer.collect(effect),
		};
	} catch (thrown) {
		return { thrown, effects: buffer.collect(effect) };
	}
}

describe("quietly", () => {
	test("runs its forms and returns the last value", () => {
		expect(run("(quietly (setq x 40) (+ x 2))").value).toBe("42");
	});

	test("asks the harness not to hand the message to the agent", () => {
		expect(run("(quietly (+ 1 2))").effects).toEqual([{ type: "quiet" }]);
	});

	test("raises nothing when the forms run without it", () => {
		expect(run("(+ 1 2)").effects).toEqual([]);
	});

	test("stays quiet when a form inside fails", () => {
		const { thrown, effects } = run('(quietly (error "load failed"))');
		expect(thrown).toBeDefined();
		expect(effects).toEqual([{ type: "quiet" }]);
	});

	test("stays quiet when a form nested deep inside fails", () => {
		expect(
			run('(quietly (+ 1 (progn (list (error "load failed")))))').effects,
		).toEqual([{ type: "quiet" }]);
	});

	test("stays quiet when a form inside holds for the user", () => {
		const { thrown, effects } = run("(quietly (list (hold)))");
		expect(thrown).toBeInstanceOf(StepHold);
		expect(effects).toEqual([{ type: "quiet" }]);
	});

	test("returns nil with nothing to run", () => {
		expect(run("(quietly)").value).toBe("nil");
	});
});
