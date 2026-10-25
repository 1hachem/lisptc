import { restore, snapshot } from "@repo/interpreter/image";
import { runAsync } from "@repo/interpreter/lisp";
import { str } from "@repo/interpreter/print";
import { describe, expect, test } from "vitest";
import { session, world } from "./helpers.ts";

describe("background", () => {
	test("start a job from an expression and hand back its id", async () => {
		const { jobs, shown } = world();
		expect(await shown("(background (+ 1 2))")).toBe('"job-1"');
		expect(jobs.specs[0]).toEqual({
			parent: "root",
			code: "(+ 1 2)",
			fork: null,
			permissions: null,
			deadlineSeconds: null,
		});
	});

	test("take code given as text as it is", async () => {
		const { jobs, shown } = world();
		await shown('(background "(* 2 3)")');
		expect(jobs.specs[0]?.code).toBe("(* 2 3)");
	});

	test("carry the options into the spec", async () => {
		const { jobs, shown } = world();
		await shown(
			'(background (scan) :fork t :permissions "(permission/deny \\"fs/*\\")" :deadline 30)',
		);
		const [spec] = jobs.specs;
		expect(spec?.fork).not.toBeNull();
		expect(spec?.permissions).toBe('(permission/deny "fs/*")');
		expect(spec?.deadlineSeconds).toBe(30);
	});

	test("run a forked job on a copy of the caller's image", async () => {
		const { shown } = world();
		await shown("(setq secret 41)");
		expect(
			await shown("(background-wait (background (+ secret 1) :fork t))"),
		).toBe('"42"');
		await expect(
			shown("(background-wait (background (+ secret 1)))"),
		).rejects.toThrow("secret");
	});

	test("refuse permissions that do not read as Lisp", async () => {
		const { jobs, shown } = world();
		await expect(shown('(background 1 :permissions "(oops")')).rejects.toThrow(
			"does not read",
		);
		expect(jobs.specs).toEqual([]);
	});

	test("refuse a deadline that is not a positive number", async () => {
		const { shown } = world();
		await expect(shown("(background 1 :deadline 0)")).rejects.toThrow(
			":deadline",
		);
	});

	test("read state, wait and cancel only jobs this session started", async () => {
		const { shown } = world();
		await shown("(setq j (background (+ 1 1)))");
		expect(await shown("(background-wait j)")).toBe('"2"');
		expect(await shown("(background-state j)")).toBe(":done");
		expect(await shown("(background-cancel j)")).toBe("nil");
		await expect(shown('(background-state "elsewhere")')).rejects.toThrow(
			"no background job",
		);
	});

	test("raise when the job failed", async () => {
		const { shown } = world();
		await expect(
			shown('(background-wait (background (error "boom")))'),
		).rejects.toThrow("boom");
	});

	test("refuse to start without a thread to run under", async () => {
		const { jobs, clock } = world();
		const interp = session(jobs, clock, null);
		await expect(runAsync(interp, "(background 1)")).rejects.toThrow(
			"no background jobs",
		);
	});

	test("keep the job ids across a snapshot and restore, sealed from Lisp", async () => {
		const { jobs, clock, interp, shown } = world();
		await shown("(setq j (background 7))");
		const image = snapshot(interp);
		const again = session(jobs, clock);
		restore(again, image);
		expect(str((await runAsync(again, "(background-wait j)")).value)).toBe(
			'"7"',
		);
		expect(
			str(
				(
					await runAsync(
						again,
						"(try (setq *background/jobs* nil) (catch (e) :sealed))",
					)
				).value,
			),
		).toBe(":sealed");
	});
});
