import { describe, expect, it } from "vitest";
import { bufferTransport } from "../src/channels-host.ts";
import { settled } from "../src/drive.ts";
import {
	ArgumentException,
	type EvalException,
	UnresolvedHead,
} from "../src/errors.ts";
import { ArityException } from "../src/func.ts";
import { type Interp, runSync } from "../src/lisp.ts";
import { str } from "../src/print.ts";
import { type Note, note } from "../src/topics.ts";
import { freshInterp } from "./helpers.ts";

interface Run {
	value: unknown;
	thrown: unknown;
	notes: Note[];
}

function run(interp: Interp, code: string): Run {
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	let value: unknown;
	let thrown: unknown;
	try {
		value = runSync(interp, code);
	} catch (ex) {
		thrown = ex;
	} finally {
		detach();
	}
	return { value, thrown, notes: buffer.collect(note) };
}

describe("the unhooked failure path is unchanged", () => {
	it("reports and rethrows an undefined head", () => {
		const { thrown, notes } = run(freshInterp(), "(no-such-fn 1)");
		expect(thrown).toBeInstanceOf(UnresolvedHead);
		expect(notes).toEqual([{ kind: "failed", text: String(thrown) }]);
	});

	it("reports and rethrows an undefined head nested in another call", () => {
		const { thrown, notes } = run(freshInterp(), "(+ 1 (no-such-fn 2))");
		expect(thrown).toBeInstanceOf(UnresolvedHead);
		expect(notes).toEqual([{ kind: "failed", text: String(thrown) }]);
	});

	it("reports and rethrows an arity failure", () => {
		const { thrown, notes } = run(freshInterp(), "((lambda (x y) x) 1)");
		expect(thrown).toBeInstanceOf(ArityException);
		expect(notes).toEqual([{ kind: "failed", text: String(thrown) }]);
	});
});

describe("a failure names the callee", () => {
	it("names the builtin an arity failure was raised in", () => {
		const { thrown } = run(freshInterp(), "(defun f (x) (car 1 2)) (f 9)");
		expect((thrown as EvalException).callee).toBe("car");
	});

	it("keeps the innermost name when a builtin is reached under another", () => {
		const { thrown } = run(freshInterp(), "(setq mycar car) (mycar 1 2)");
		expect((thrown as EvalException).callee).toBe("car");
	});

	it("names the builtin an argument failure was raised in", () => {
		const { thrown } = run(freshInterp(), '(car "x")');
		expect(thrown).toBeInstanceOf(ArgumentException);
		expect((thrown as EvalException).callee).toBe("car");
	});
});

describe("an argument failure carries where it failed", () => {
	it("carries the rejected value and its index", () => {
		const { thrown } = run(freshInterp(), '(car "x")');
		const failure = thrown as ArgumentException;
		expect(failure.value).toBe("x");
		expect(failure.at).toBe(0);
	});
});

describe("an arity failure carries what it expected", () => {
	it("carries a fixed arity and what was given", () => {
		const { thrown } = run(freshInterp(), "((lambda (x y) x) 1)");
		const failure = thrown as ArityException;
		expect(failure.expected).toEqual({ min: 2, max: 2 });
		expect(failure.given).toBe(1);
	});

	it("leaves the maximum open for a rest argument", () => {
		const { thrown } = run(freshInterp(), "((lambda (x &rest ys) x))");
		const failure = thrown as ArityException;
		expect(failure.expected).toEqual({ min: 1, max: undefined });
		expect(failure.given).toBe(0);
	});
});

describe("a hook decides what a failure reports", () => {
	it("replaces the reported text and still rethrows", () => {
		const interp = freshInterp();
		interp.hooks.failedForm.use(function* () {
			return yield* settled({ reported: "did you mean something else?" });
		});
		const { thrown, notes } = run(interp, "(no-such-fn)");
		expect(notes).toEqual([
			{ kind: "failed", text: "did you mean something else?" },
		]);
		expect(thrown).toBeInstanceOf(UnresolvedHead);
	});

	it("excuses the form and yields the previous value", () => {
		const interp = freshInterp();
		interp.hooks.failedForm.use(function* () {
			return yield* settled({ skipped: "read as prose" });
		});
		const { value, thrown, notes } = run(interp, "1 (no-such-fn)");
		expect(thrown).toBeUndefined();
		expect(str(value)).toBe("1");
		expect(notes).toEqual([{ kind: "skipped", text: "read as prose" }]);
	});

	it("sees a failure that is not a head failure", () => {
		const interp = freshInterp();
		const seen: string[] = [];
		interp.hooks.failedForm.use(function* (_interp, _form, error) {
			seen.push(error.callee ?? "?");
			return yield* settled(undefined);
		});
		run(interp, "(car 1 2)");
		expect(seen).toEqual(["car"]);
	});
});
