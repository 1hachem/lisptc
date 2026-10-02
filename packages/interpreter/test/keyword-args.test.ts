import { describe, expect, it } from "vitest";
import { ArityException, KeywordException } from "../src/func.ts";
import { runSync } from "../src/lisp.ts";
import { ev, freshInterp } from "./helpers.ts";

function thrownBy(code: string): unknown {
	const interp = freshInterp();
	try {
		runSync(interp, code);
	} catch (ex) {
		return ex;
	}
	return undefined;
}

const KPI = "(defun kpi (&key label value unit) (list label value unit))";

describe("a &key argument is filled by position", () => {
	it("fills left to right", () => {
		expect(ev(`${KPI} (kpi "Revenue" 42000 "USD")`)).toBe(
			'("Revenue" 42000 "USD")',
		);
	});

	it("leaves what was not given as nil", () => {
		expect(ev(`${KPI} (kpi "Revenue")`)).toBe('("Revenue" nil nil)');
	});

	it("takes none at all", () => {
		expect(ev(`${KPI} (kpi)`)).toBe("(nil nil nil)");
	});
});

describe("a &key argument is filled by name", () => {
	it("binds each name wherever it appears", () => {
		expect(ev(`${KPI} (kpi :value 42000 :label "Revenue")`)).toBe(
			'("Revenue" 42000 nil)',
		);
	});

	it("takes positions first and names after", () => {
		expect(ev(`${KPI} (kpi "Revenue" :unit "USD")`)).toBe(
			'("Revenue" nil "USD")',
		);
	});

	it("evaluates a keyword argument's value", () => {
		expect(ev(`${KPI} (kpi :value (+ 1 2))`)).toBe("(nil 3 nil)");
	});

	it("passes a keyword as a value when it follows a name", () => {
		expect(ev(`${KPI} (kpi :label :blue)`)).toBe("(:blue nil nil)");
	});
});

describe("required arguments come before &key", () => {
	const f = "(defun f (a b &key c) (list a b c))";

	it("still demands the required ones", () => {
		expect(ev(`${f} (f 1 2)`)).toBe("(1 2 nil)");
	});

	it("names the optional one after them", () => {
		expect(ev(`${f} (f 1 2 :c 3)`)).toBe("(1 2 3)");
	});

	it("fails when a required one is missing", () => {
		const failure = thrownBy(`${f} (f 1)`);
		expect(failure).toBeInstanceOf(ArityException);
		expect((failure as ArityException).expected).toEqual({ min: 2, max: 3 });
		expect((failure as ArityException).given).toBe(1);
	});

	it("fails when a keyword arrives before the required ones are filled", () => {
		const failure = thrownBy(`${f} (f 1 :c 3)`);
		expect(failure).toBeInstanceOf(ArityException);
	});
});

describe("a keyword call that is wrong says why", () => {
	it("rejects a name the function does not take", () => {
		const failure = thrownBy(`${KPI} (kpi :colour "red")`);
		expect(failure).toBeInstanceOf(KeywordException);
		expect((failure as KeywordException).key).toBe("colour");
		expect((failure as KeywordException).accepted).toEqual([
			"label",
			"value",
			"unit",
		]);
	});

	it("rejects a name with no value after it", () => {
		expect(thrownBy(`${KPI} (kpi :label)`)).toBeInstanceOf(KeywordException);
	});

	it("rejects a value with no name before it", () => {
		expect(thrownBy(`${KPI} (kpi :label "a" "b")`)).toBeInstanceOf(
			KeywordException,
		);
	});

	it("rejects the same argument given twice", () => {
		expect(thrownBy(`${KPI} (kpi :label "a" :label "b")`)).toBeInstanceOf(
			KeywordException,
		);
	});

	it("rejects a name that repeats one already filled by position", () => {
		expect(thrownBy(`${KPI} (kpi "a" :label "b")`)).toBeInstanceOf(
			KeywordException,
		);
	});

	it("rejects too many positional arguments", () => {
		expect(thrownBy(`${KPI} (kpi 1 2 3 4)`)).toBeInstanceOf(ArityException);
	});

	it("names the function the failure came from", () => {
		const failure = thrownBy(`${KPI} (kpi :colour "red")`);
		expect((failure as KeywordException).callee).toBe("kpi");
	});
});

describe("an arglist may not mix &key with &rest", () => {
	it("refuses &rest after &key", () => {
		expect(() => ev("(defun f (&key a &rest b) a)")).toThrow();
	});

	it("refuses a second &key", () => {
		expect(() => ev("(defun f (&key a &key b) a)")).toThrow();
	});

	it("refuses &key with nothing after it", () => {
		expect(() => ev("(defun f (a &key) a)")).toThrow();
	});
});

describe("a &key defun documents the names it takes", () => {
	it("registers each keyword argument as a documented one", () => {
		const interp = freshInterp();
		runSync(interp, '(defun kpi (&key label value) "One number." nil)');

		expect(interp.docs().get("kpi")?.args).toEqual([
			{ name: "label", type: "any", required: false },
			{ name: "value", type: "any", required: false },
		]);
	});

	it("documents only the names after &key", () => {
		const interp = freshInterp();
		runSync(interp, '(defun f (a &key b) "Two." nil)');

		expect(interp.docs().get("f")?.args).toEqual([
			{ name: "b", type: "any", required: false },
		]);
	});

	it("leaves a function with no &key undocumented for arguments", () => {
		const interp = freshInterp();
		runSync(interp, '(defun g (a b) "Two." nil)');

		expect(interp.docs().get("g")?.args).toBeUndefined();
	});
});

describe("a &key lambda closes over its environment", () => {
	it("keeps its keys through the closure", () => {
		expect(ev("(let ((n 10)) ((lambda (&key x) (+ n x)) :x 5))")).toBe("15");
	});
});
