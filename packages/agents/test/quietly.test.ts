import { bufferTransport } from "@repo/interpreter/channels-host";
import { effect } from "@repo/interpreter/effects";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { describe, expect, test } from "vitest";
import { agentsExtension } from "../src/agents.ts";
import { agentsHostFor } from "../src/agents-host.ts";

function run(code: string) {
	const interp = new Interp({ extensions: [agentsExtension(agentsHostFor())] });
	runSync(interp, prelude);
	const buffer = bufferTransport();
	interp.channels.pipe(buffer);
	const value = str(runSync(interp, code));
	return { value, effects: buffer.collect(effect) };
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

	test("returns nil with nothing to run", () => {
		expect(run("(quietly)").value).toBe("nil");
	});
});
