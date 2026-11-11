import type { JudgeRequest } from "@repo/shared/system-one";
import { describe, expect, it } from "vitest";
import { semanticExtension } from "../src/semantic.ts";
import { semanticHost } from "../src/semantic-host.ts";
import { itemAt, judging, picked, rated, yes } from "./helpers.ts";

function item(req: JudgeRequest, id: string): unknown {
	return (req.state as { items: unknown[] }).items[itemAt(id)];
}

describe("comparison", () => {
	it("compares numbers exactly without asking the judge", async () => {
		const { ev, seen } = judging(() => yes(1));
		expect(await ev("(%= 2 2.0)")).toBe("t");
		expect(await ev("(%= 1 2)")).toBe("nil");
		expect(await ev("(%< 1 2)")).toBe("t");
		expect(await ev("(%>= 1 2)")).toBe("nil");
		expect(seen).toHaveLength(0);
	});

	it("judges two texts by meaning", async () => {
		const { ev } = judging(() => yes(0.9));
		expect(await ev('(%= "Hi there!" "Hello!")')).toBe("t");
		expect(await ev('(%/= "Hi there!" "Hello!")')).toBe("nil");
	});

	it("holds a judgment to the threshold :min sets", async () => {
		const { ev } = judging(() => yes(0.6));
		expect(await ev('(%= "cold" "chilly")')).toBe("t");
		expect(await ev('(%= "cold" "chilly" :min 0.8)')).toBe("nil");
	});

	it("answers the same question twice from one judge call", async () => {
		const { ev, seen } = judging(() => yes(0.9));
		await ev('(%= "Hi" "Hello")');
		await ev('(%/= "Hi" "Hello")');
		expect(seen).toHaveLength(1);
	});

	it("orders texts by the judged dimension", async () => {
		const { ev } = judging(() => yes(0.8));
		expect(await ev('(%< "a cat" "a horse" :by "size")')).toBe("t");
	});

	it("asks the judge again after a failed call", async () => {
		let calls = 0;
		const { ev, failure } = judging(() => {
			calls += 1;
			if (calls === 1) throw new Error("judge unreachable");
			return yes(0.9);
		});
		expect(await failure('(%= "a" "b")')).toContain("judge unreachable");
		expect(await ev('(%= "a" "b")')).toBe("t");
	});
});

describe("predicates on one value", () => {
	it("answers a literal match without the judge", async () => {
		const { ev, seen } = judging(() => yes(0));
		expect(await ev('(%string-contains? "please refund me" "refund")')).toBe(
			"t",
		);
		expect(await ev('(%string-prefix? "hello there" "hello")')).toBe("t");
		expect(seen).toHaveLength(0);
	});

	it("judges what a literal match cannot see", async () => {
		const { ev } = judging(() => yes(0.85));
		expect(
			await ev('(%string-contains? "I want my money back" "a refund")'),
		).toBe("t");
		expect(await ev('(%is-a (list "Ada" 36) "person data")')).toBe("t");
	});

	it("says when the facts are not enough", async () => {
		const { ev } = judging(() => yes(0.2));
		expect(await ev('(%enough? "to Paris" "to book the flight")')).toBe("nil");
	});
});

describe("%p and %score", () => {
	it("returns the raw probability of yes", async () => {
		const { ev } = judging(() => yes(0.25));
		expect(await ev('(%p "charged twice" "is a refund request")')).toBe("0.25");
	});

	it("returns where the value falls on the levels", async () => {
		const { ev } = judging(() => rated(1.5));
		expect(
			await ev('(%score "server down" "urgency" \'("can wait" "today" "now"))'),
		).toBe("1.5");
	});

	it("refuses a rubric of one level", async () => {
		const { failure } = judging(() => rated(0));
		expect(await failure('(%score "x" "urgency" \'("only"))')).toContain(
			"between 2 and 10 levels",
		);
	});
});

describe("%choose", () => {
	it("returns the option as it was written", async () => {
		const { ev } = judging(() =>
			picked("billing", { billing: 0.8, technical: 0.2 }),
		);
		expect(await ev('(%choose "charged twice" \'(:billing :technical))')).toBe(
			":billing",
		);
	});

	it("returns the :none value when nothing fits", async () => {
		const { ev } = judging(() => picked("none", { none: 0.9, billing: 0.1 }));
		expect(
			await ev('(%choose "hello" \'(:billing :technical) :none :other)'),
		).toBe(":other");
	});

	it("returns the :none value when the best option is below :min", async () => {
		const { ev } = judging(() =>
			picked("billing", { billing: 0.4, technical: 0.35, none: 0.25 }),
		);
		expect(
			await ev(
				'(%choose "hmm" \'(:billing :technical) :none :unsure :min 0.6)',
			),
		).toBe(":unsure");
	});
});

describe("lists", () => {
	const spam = (req: JudgeRequest, id: string) =>
		yes(String(item(req, id)).includes("WIN") ? 0.9 : 0.1);

	it("filters a list in one judge call", async () => {
		const { ev, seen } = judging((_, id, req) => spam(req, id));
		expect(
			await ev('(%remove-if "spam" (list "hi Bob" "WIN cash" "lunch?"))'),
		).toBe('("hi Bob" "lunch?")');
		expect(
			await ev('(%filter "spam" (list "hi Bob" "WIN cash" "lunch?"))'),
		).toBe('("WIN cash")');
		expect(seen).toHaveLength(1);
	});

	it("counts and quantifies over a list", async () => {
		const { ev } = judging((_, id, req) => spam(req, id));
		expect(await ev('(%count-if "spam" (list "WIN" "hi" "WIN big"))')).toBe(
			"2",
		);
		expect(await ev('(%some "spam" (list "hi" "WIN"))')).toBe("t");
		expect(await ev('(%every "spam" (list "hi" "WIN"))')).toBe("nil");
	});

	it("finds an equal member without the judge", async () => {
		const { ev, seen } = judging(() => yes(0));
		expect(await ev('(%member "b" (list "a" "b" "c"))')).toBe('("b" "c")');
		expect(seen).toHaveLength(0);
	});

	it("finds a member by meaning", async () => {
		const { ev } = judging((_, id, req) =>
			yes(item(req, id) === "money back" ? 0.9 : 0.1),
		);
		expect(
			await ev('(%member "a refund" (list "a bug" "money back" "praise"))'),
		).toBe('("money back" "praise")');
	});

	it("finds the element that matches a description", async () => {
		const { ev } = judging(() =>
			picked("1", { "0": 0.1, "1": 0.8, none: 0.1 }),
		);
		expect(await ev('(%find "a pet" (list "a rock" "a dog"))')).toBe('"a dog"');
		expect(await ev('(%position "a pet" (list "a rock" "a dog"))')).toBe("1");
	});

	it("finds nothing when no element fits", async () => {
		const { ev } = judging(() => picked("none", { "0": 0.1, none: 0.9 }));
		expect(await ev('(%find "a pet" (list "a rock"))')).toBe("nil");
	});

	it("sorts by a judged dimension", async () => {
		const urgency: Record<string, number> = { outage: 4, typo: 0, slow: 2 };
		const { ev } = judging((_, id, req) =>
			rated(urgency[String(item(req, id))] ?? 0),
		);
		const tickets = '(list "slow" "outage" "typo")';
		expect(await ev(`(%sort ${tickets} :by "urgency")`)).toBe(
			'("typo" "slow" "outage")',
		);
		expect(await ev(`(%sort ${tickets} :by "urgency" :desc t)`)).toBe(
			'("outage" "slow" "typo")',
		);
		expect(await ev(`(%max ${tickets} :by "urgency")`)).toBe('"outage"');
		expect(await ev(`(%min ${tickets} :by "urgency")`)).toBe('"typo"');
	});

	it("asks what to sort by", async () => {
		const { failure } = judging(() => rated(0));
		expect(await failure('(%sort (list "a" "b"))')).toContain(":by");
	});
});

describe("branching", () => {
	it("runs the clause the judge picks", async () => {
		const { ev } = judging(() =>
			picked("reports a bug", {
				"asks for a refund": 0.1,
				"reports a bug": 0.85,
				none: 0.05,
			}),
		);
		expect(
			await ev(`(%cond "the app crashes on save"
			            ("asks for a refund" :refund)
			            ("reports a bug" :bug)
			            (t :escalate))`),
		).toBe(":bug");
	});

	it("runs the t clause when no test fits", async () => {
		const { ev } = judging(() =>
			picked("none", { "asks for a refund": 0.1, none: 0.9 }),
		);
		expect(
			await ev(`(%cond "hello" ("asks for a refund" :refund) (t :escalate))`),
		).toBe(":escalate");
	});

	it("dispatches on the keyword the judge picks", async () => {
		const { ev } = judging(() =>
			picked("hot", { hot: 0.9, mild: 0.1, none: 0 }),
		);
		expect(
			await ev(
				`(%case "35C and humid" (:hot "stay in") (:mild "walk") (t "look again"))`,
			),
		).toBe('"stay in"');
	});
});

describe("the memories", () => {
	it("fill every value they take from code", () => {
		expect(semanticExtension(semanticHost).memories).not.toMatch(/\{\{|\}\}/);
	});
});
