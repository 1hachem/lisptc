import { openSession, type StepOutcome } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { proseExtension } from "../src/prose.ts";
import { proseHost } from "../src/prose-host.ts";
import { evProse, proseInterp } from "./helpers.ts";

const silent: StepOutcome = {
	model: "",
	user: "",
	skipped: ["read as prose"],
	failed: false,
};

function answers(code: string): boolean {
	const interp = proseInterp();
	evProse(code, interp);
	const hooks = openSession([proseExtension(proseHost)]);
	return hooks.answered.run(
		() => false,
		{ interp, code, emit: () => {} },
		silent,
	);
}

describe("a silent step with skipped prose", () => {
	it("answers when nothing in it ran", () => {
		expect(answers("All set (see below).")).toBe(true);
	});

	it("does not answer when a form in it ran", () => {
		expect(answers("Defining it (see below)\n(defun probe (x) (+ x 1))")).toBe(
			false,
		);
	});

	it("does not answer when a call ran inside the prose", () => {
		expect(answers("(see the sum (+ 1 2) below)")).toBe(false);
	});
});
