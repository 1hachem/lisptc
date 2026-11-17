import { describe, expect, it } from "vitest";
import { kgRepl } from "./helpers.ts";

const family = `
(kg/new "family")
(fact (parent tom bob))
(fact (parent bob ann))
(fact (parent bob liz))
(<- (grandparent ?x ?z) (parent ?x ?y) (parent ?y ?z))
`;

describe("backward chaining", () => {
	it("answers a goal through a rule with the first solution", () => {
		const ev = kgRepl();
		ev(family);
		expect(ev("(?- (grandparent tom ?who))")).toBe("((?who . ann))");
	});

	it("lists every solution", () => {
		const ev = kgRepl();
		ev(family);
		expect(ev("(?all ?who (grandparent tom ?who))")).toBe("(ann liz)");
		expect(ev("(?all (?p ?c) (parent ?p ?c) :limit 2)")).toBe(
			"((tom bob) (bob ann))",
		);
	});

	it("gives t for a ground goal that holds and nil for one that fails", () => {
		const ev = kgRepl();
		ev(family);
		expect(ev("(?- (parent tom bob))")).toBe("t");
		expect(ev("(?- (parent ann tom))")).toBe("nil");
	});

	it("backtracks through list patterns", () => {
		const ev = kgRepl();
		ev(`(kg/new "lists")
			(<- (app nil ?l ?l))
			(<- (app (?h . ?t) ?l (?h . ?r)) (app ?t ?l ?r))`);
		expect(ev("(?all (?a ?b) (app ?a ?b (1 2)))")).toBe(
			"((nil (1 2)) ((1) (2)) ((1 2) nil))",
		);
	});

	it("cuts the remaining clauses", () => {
		const ev = kgRepl();
		ev(`(kg/new "cut")
			(<- (sign ?n neg) (test (< ?n 0)) !)
			(<- (sign ?n pos))`);
		expect(ev("(?all ?s (sign -3 ?s))")).toBe("(neg)");
		expect(ev("(?all ?s (sign 3 ?s))")).toBe("(pos)");
	});

	it("negates by failure and computes with Lisp", () => {
		const ev = kgRepl();
		ev(family);
		ev("(<- (childless ?x) (parent ?_ ?x) (not (parent ?x ?_)))");
		ev("(<- (age-next ?a ?b) (is ?b (+ ?a 1)))");
		expect(ev("(?all ?x (childless ?x))")).toBe("(ann liz)");
		expect(ev("(?- (age-next 41 ?b))")).toBe("((?b . 42))");
	});

	it("takes Lisp values through unquote", () => {
		const ev = kgRepl();
		ev(family);
		ev("(setq who (quote tom))");
		expect(ev("(?- (grandparent ,who ?g))")).toBe("((?g . ann))");
	});

	it("runs a body per solution", () => {
		const ev = kgRepl();
		ev(family);
		expect(
			ev("(let ((n 0)) (do-solutions ((parent bob ?c)) (setq n (+ n 1))) n)"),
		).toBe("2");
	});

	it("proves deep recursion without exhausting the stack", () => {
		const ev = kgRepl();
		ev(`(kg/new "count")
			(<- (down 0))
			(<- (down ?n) (test (> ?n 0)) (is ?m (- ?n 1)) (down ?m))`);
		expect(ev("(?- (down 50000) :budget 1000000)")).toBe("t");
	});

	it("fails a runaway search with a budget error, not nil", () => {
		const ev = kgRepl();
		ev(`(kg/new "loop")
			(fact (edge a b))
			(<- (path ?x ?y) (path ?x ?z) (edge ?z ?y))`);
		expect(ev("(try (?- (path a b) :budget 500) (catch (e) (car e)))")).toBe(
			":kg-budget",
		);
	});
});
