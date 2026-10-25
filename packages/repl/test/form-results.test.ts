import { settled } from "@repo/interpreter/drive";
import type { Interp } from "@repo/interpreter/lisp";
import { describe, expect, test } from "vitest";
import { MemoryImageStore } from "../src/image-store.ts";
import { AgentRepl } from "../src/repl.ts";
import { memoryRepl } from "./helpers.ts";

function skippingFailures(interp: Interp): void {
	interp.hooks.failedForm.use(() => settled({ skipped: "read as prose" }));
}

describe("a step's results", () => {
	test("hold the printed value of each top-level form, in order", async () => {
		const { results } = await memoryRepl().evalOutput(
			'(+ 1 2) (list 1 "a") (echo 5)',
		);
		expect(results).toEqual(["3", '(1 "a")']);
	});

	test("leave out a form that was skipped as prose", async () => {
		const { results, user } = await memoryRepl([skippingFailures]).evalOutput(
			"(no-such-fn) (+ 1 1)",
		);
		expect(results).toEqual(["2"]);
		expect(user).toContain("skipped read as prose");
	});

	test("stop at the form that failed", async () => {
		const { results } = await memoryRepl().evalOutput(
			"(+ 1 1) (car 5) (+ 2 2)",
		);
		expect(results).toEqual(["2"]);
	});

	test("are still recorded once the session resumed from an image", async () => {
		const images = new MemoryImageStore();
		await new AgentRepl({ extensions: [], images }).evalOutput("(setq n 41)");
		const resumed = new AgentRepl({ extensions: [], images });
		await resumed.resume();
		const { results } = await resumed.evalOutput("(+ n 1)");
		expect(results).toEqual(["42"]);
	});
});
