import { describe, expect, it } from "vitest";
import { kgExtension } from "../src/kg.ts";
import { kgHostFor } from "../src/kg-host.ts";
import { kgRepl, MemoryGraphStore } from "./helpers.ts";

describe("forward chaining", () => {
	const chain = `
(kg/new "family")
(fact (parent tom bob))
(fact (parent bob ann))
(defrule anc (parent ?x ?y) => (anc ?x ?y))
(defrule anc-step (anc ?x ?y) (parent ?y ?z) => (anc ?x ?z))
`;

	it("derives the closure of its rules", () => {
		const ev = kgRepl();
		ev(chain);
		expect(ev("(?all ?d (anc tom ?d))")).toBe("(bob ann)");
	});

	it("drops a conclusion once its premise is retracted", () => {
		const ev = kgRepl();
		ev(chain);
		expect(ev("(retract (parent bob ann))")).toBe("1");
		expect(ev("(?all ?d (anc tom ?d))")).toBe("(bob)");
	});

	it("keeps a conclusion that another justification still holds", () => {
		const ev = kgRepl();
		ev(chain);
		ev("(fact (anc tom ann) :basis user)");
		ev("(retract (parent bob ann))");
		expect(ev("(?- (anc tom ann))")).toBe("t");
	});

	it("makes rules from rules", () => {
		const ev = kgRepl();
		ev(`(kg/new "meta")
			(fact (symmetric married))
			(fact (married ann bob))
			(defrule sym (symmetric ?r) => (<- (?r ?y ?x) (?r ?x ?y)))`);
		expect(ev("(?- (married bob ann))")).toBe("t");
	});

	it("explains a derived fact down to its supports", () => {
		const ev = kgRepl();
		ev(chain);
		const proof = ev("(why (anc tom ann))");
		expect(proof).toContain(":derived");
		expect(proof).toContain("anc-step");
		expect(proof).toContain("(parent bob ann)");
	});
});

describe("evidence and conflicts", () => {
	const calendar = `
(kg/new "calendar")
(predicate starts (event :key) (time :type string))
(fact (starts dentist "09:00") :basis observed :from "mail.pdf" :at (:page 1) :quote "at 9:00")
(<- (busy ?t) (starts ?_ ?t))
`;

	it("returns the supports a fact was asserted with", () => {
		const ev = kgRepl();
		ev(calendar);
		expect(ev("(why (starts dentist ?t))")).toContain(':from "mail.pdf"');
	});

	it("keeps both sides of a key conflict out of inference", () => {
		const ev = kgRepl();
		ev(calendar);
		ev('(fact (starts dentist "10:00") :basis user)');
		expect(ev("(?all ?t (busy ?t))")).toBe("nil");
		expect(ev("(length (kg/conflicts))")).toBe("1");
	});

	it("uses the side left after a conflict is retracted", () => {
		const ev = kgRepl();
		ev(calendar);
		ev('(fact (starts dentist "10:00") :basis user)');
		ev('(retract (starts dentist "09:00"))');
		expect(ev("(?all ?t (busy ?t))")).toBe('("10:00")');
	});

	it("filters facts by the basis of their support", () => {
		const ev = kgRepl();
		ev(calendar);
		ev('(fact (starts lunch "12:00") :basis proposed)');
		expect(ev("(?all ?e (starts ?e ?_) :basis (observed))")).toBe("(dentist)");
	});

	it("refuses a fact of the wrong type or arity", () => {
		const ev = kgRepl();
		ev(calendar);
		expect(ev("(try (fact (starts gym 9)) (catch (e) 'refused))")).toBe(
			"refused",
		);
		expect(ev("(try (fact (starts gym)) (catch (e) 'refused))")).toBe(
			"refused",
		);
	});

	it("drops only the supports of one document", () => {
		const ev = kgRepl();
		ev(calendar);
		ev('(fact (starts dentist "09:00") :basis observed :from "sms.txt")');
		expect(ev('(retract (starts dentist ?_) :from "mail.pdf")')).toBe("1");
		expect(ev("(?- (starts dentist ?t))")).toBe('((?t . "09:00"))');
	});
});

describe("persistence", () => {
	it("reads back in a new session what an earlier one wrote", () => {
		const store = new MemoryGraphStore();
		const first = kgRepl(store);
		first(`(kg/new "family" :doc "who is whose parent")
			(predicate parent (p) (c))
			(fact (parent tom bob) :basis observed :from "tree.pdf" :quote "Tom, father of Bob")
			(<- (grandparent ?x ?z) (parent ?x ?y) (parent ?y ?z))
			(defrule anc (parent ?x ?y) => (anc ?x ?y))
			(fact (parent bob ann))`);
		const second = kgRepl(store);
		expect(second("(?- (grandparent tom ?g))")).toBe("((?g . ann))");
		expect(second("(?- (anc tom bob))")).toBe("t");
		expect(second('(kg/source "family")')).toContain("Tom, father of Bob");
	});

	it("sees what another session wrote since", () => {
		const store = new MemoryGraphStore();
		const reader = kgRepl(store);
		const writer = kgRepl(store);
		reader('(kg/new "shared") (fact (seen a))');
		writer('(kg/use "shared") (fact (seen b))');
		expect(reader("(?all ?x (seen ?x))")).toBe("(a b)");
	});

	it("stores no derived fact", () => {
		const store = new MemoryGraphStore();
		const ev = kgRepl(store);
		ev(`(kg/new "family")
			(fact (parent tom bob))
			(defrule anc (parent ?x ?y) => (anc ?x ?y))
			(?- (anc tom bob))`);
		expect(store.graphs.get("family")).not.toContain("(anc tom bob)");
	});

	it("forgets a dropped graph", () => {
		const store = new MemoryGraphStore();
		const ev = kgRepl(store);
		ev('(kg/new "tmp") (fact (x 1)) (kg/drop "tmp")');
		expect(store.graphs.has("tmp")).toBe(false);
		expect(kgRepl(store)("(?- (x 1))")).toBe("nil");
	});

	it("takes its prompt from the host", () => {
		const extension = kgExtension({
			...kgHostFor({ store: new MemoryGraphStore() }),
			prompt: () => "supplied",
		});
		expect(extension.prompt).toBe("supplied");
	});
});
