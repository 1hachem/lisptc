import { describe, expect, it } from "vitest";
import { freshInterp, reportOf } from "./helpers.ts";

const KPI =
	'(defun kpi (&key label value unit) "One number, big." (list label value unit))';

function withKpi() {
	const interp = freshInterp();
	reportOf(KPI, interp);
	return interp;
}

describe("a keyword the function does not take is answered", () => {
	it("names the nearest keyword it does take", () => {
		const text = reportOf('(kpi :labl "Revenue")', withKpi());
		expect(text).toContain("no such keyword argument: :labl");
		expect(text).toContain("did you mean :label");
	});

	it("lists what it takes when nothing is close", () => {
		const text = reportOf('(kpi :zzzzzzz "x")', withKpi());
		expect(text).toContain("it takes :label :value :unit");
	});

	it("shows the signature under the answer", () => {
		const text = reportOf('(kpi :labl "Revenue")', withKpi());
		expect(text).toContain("(kpi &key label value unit)");
	});
});

describe("other keyword mistakes are answered too", () => {
	it("answers a keyword given with no value", () => {
		const text = reportOf("(kpi :label)", withKpi());
		expect(text).toContain("keyword given with no value: :label");
		expect(text).toContain("(kpi &key label value unit)");
	});

	it("answers the same argument given twice", () => {
		const text = reportOf('(kpi :label "a" :label "b")', withKpi());
		expect(text).toContain("argument given twice: :label");
	});

	it("answers a value with no keyword before it", () => {
		const text = reportOf('(kpi :label "a" "b")', withKpi());
		expect(text).toContain("expected a keyword, not a value");
	});
});

describe("an arity failure on a keyed function still reports its range", () => {
	it("counts only the positional arguments it requires", () => {
		const interp = freshInterp();
		reportOf('(defun f (a b &key c) "Two and one." (list a b c))', interp);
		const text = reportOf("(f 1)", interp);
		expect(text).toContain("given 1, takes 2 to 3");
	});
});
