import { bufferTransport } from "@repo/interpreter/channels-host";
import {
	arrayToList,
	Cell,
	Interp,
	listToArray,
	newSym,
	prelude,
	runAsync,
	runSync,
	str,
} from "@repo/interpreter/lisp";
import {
	type Bounded,
	noAnnotations,
	openSession,
	type StepContext,
} from "@repo/interpreter/session";
import type { Clock } from "@repo/shared/host";
import type { Judge, JudgeRequest, Question } from "@repo/shared/judge";
import { describe, expect, it } from "vitest";
import { judgeLearner } from "../src/learn-client.ts";
import {
	type Assessment,
	COPIED_AT,
	COVERED_AT,
	FORGET_AT,
	INITIAL_SCORE,
	type Judgment,
	KNOWN_BODY_CHARS,
	KNOWN_SEEN,
	LEARN_AT,
	type Learned,
	type Learner,
	type Learning,
	MemoryBank,
	memoryExtension,
	type Observed,
	OUTPUT_CHARS,
	type Proposed,
	RAN_CHARS,
	SAID_CHARS,
	SPANS_SEEN,
	SUSPECT_AT,
	slugFor,
	type Vetting,
	VolatileStore,
	type Watcher,
	WINDOW,
} from "../src/memory.ts";

const AT = 1_700_000_000_000;

const frozen: Clock = { now: () => AT };

function keeping(over: Partial<Judgment> = {}): Judgment {
	return {
		worthKeeping: LEARN_AT + 0.1,
		kind: "procedure",
		kindConfidence: 0.9,
		candidate: '(mcp/call "acme" "browser_navigate" url)',
		calibrated: true,
		...over,
	};
}

interface Fake extends Learner {
	readonly seen: Observed[];
	readonly proposed: Proposed[];
	inFlight: number;
	peak: number;
}

function learnerOf(
	judgments: readonly (Judgment | undefined)[],
	vetting?: Vetting | (() => never),
): Fake {
	const fake: Fake = {
		seen: [],
		proposed: [],
		inFlight: 0,
		peak: 0,
		async consider(observed) {
			fake.inFlight += 1;
			fake.peak = Math.max(fake.peak, fake.inFlight);
			const index = fake.seen.length;
			fake.seen.push(observed);
			await Promise.resolve();
			fake.inFlight -= 1;
			return judgments[index];
		},
		vet(proposal) {
			fake.proposed.push(proposal);
			if (typeof vetting === "function") return vetting();
			return vetting;
		},
	};
	return fake;
}

interface Ran {
	learned: Learned[];
	judged: Assessment[];
	model: string;
}

interface Fixture {
	interp: Interp;
	bank: MemoryBank;
	watched: Learning[];
	step(code: string): Promise<Ran>;
	said(text: string): void;
}

function notes(step: Ran): string {
	return step.learned.map((one) => one.text).join("\n");
}

function fixture(learner: Learner, clock: Clock = frozen): Fixture {
	const store = new VolatileStore();
	const watched: Learning[] = [];
	const watch: Watcher = (event) => {
		watched.push(event);
	};
	const bank = new MemoryBank(store, clock, learner, watch);
	const extension = memoryExtension(
		{ store, clock, learn: learner, watch, prompt: () => "" },
		{ bank },
	);
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	const hooks = openSession([extension]);
	return {
		interp,
		bank,
		watched,
		async step(code: string): Promise<Ran> {
			const ctx: StepContext = { interp, code, emit: () => {} };
			const buffer = bufferTransport();
			const detach = interp.channels.pipe(buffer);
			let output = "";
			let settled: Bounded = { model: "", user: "" };
			try {
				await hooks.evalStep.run(async (inner) => {
					try {
						output = str((await runAsync(interp, inner.code)).value);
					} catch (ex) {
						output = String(ex);
					}
				}, ctx);
				const bounded = hooks.stepOutput.run((_inner, out) => out, ctx, {
					model: output,
					user: output,
				});
				settled = await hooks.stepSettled.run(
					async (_inner, out) => out,
					ctx,
					bounded,
				);
			} finally {
				detach();
			}
			const annotations = hooks.annotate.run(
				(_b, into) => into,
				buffer,
				noAnnotations(),
			);
			return {
				learned: (annotations.step.learned ?? []) as Learned[],
				judged: (annotations.output.judged ?? []) as Assessment[],
				model: settled.model,
			};
		},
		said(text: string): void {
			const before = interp.getGlobal(newSym("user-messages"));
			const all = before instanceof Cell ? listToArray(before) : [];
			interp.defineGlobal(newSym("user-messages"), arrayToList([...all, text]));
		},
	};
}

describe("the learning gate", () => {
	it("emits the nudge on the step it judged", async () => {
		const f = fixture(learnerOf([keeping()]));

		const next = await f.step("(+ 1 2)");

		expect(next.learned.map((one) => one.what)).toEqual(["candidate"]);
		expect(notes(next)).toContain("memory/remember");
		expect(notes(next)).toContain('(mcp/call "acme" "browser_navigate" url)');
	});

	it("hands the learner a window, so a failure and its fix arrive together", async () => {
		const learner = learnerOf([undefined, undefined]);
		const f = fixture(learner);

		await f.step("(no-such-function 1)");
		await f.step('(concat "all" " well")');

		expect(learner.seen).toHaveLength(2);
		expect(learner.seen[0].recent).toHaveLength(1);
		const window = learner.seen[1].recent;
		expect(window).toHaveLength(2);
		expect(window[0].ran).toBe("(no-such-function 1)");
		expect(window[0].failed).toBe(true);
		expect(window[1].ran).toBe('(concat "all" " well")');
		expect(window[1].failed).toBe(false);
	});

	it("keeps the window to WINDOW steps", async () => {
		const learner = learnerOf([]);
		const f = fixture(learner);

		for (let i = 0; i < WINDOW + 2; i++) await f.step(`(+ ${i} 1)`);

		expect(learner.seen.at(-1)?.recent).toHaveLength(WINDOW);
	});

	it("holds every cap in the budget against an oversized step", async () => {
		const learner = learnerOf([]);
		const f = fixture(learner);
		for (let i = 0; i < KNOWN_SEEN + 5; i++)
			await runAsync(
				f.interp,
				`(memory/remember "k${i}" "${"b".repeat(400)}")`,
			);
		f.said("s".repeat(SAID_CHARS * 2));

		await f.step(`(quote "${"x".repeat(RAN_CHARS * 2)}")`);

		const seen = learner.seen.at(-1);
		expect(seen).toBeDefined();
		if (seen === undefined) return;
		expect(seen.said?.length).toBe(SAID_CHARS);
		expect(seen.recent[0].ran.length).toBe(RAN_CHARS);
		expect(seen.recent[0].output.length).toBe(OUTPUT_CHARS);
		expect(seen.known).toHaveLength(KNOWN_SEEN);
		for (const memory of seen.known)
			expect(memory.body.length).toBe(KNOWN_BODY_CHARS);
	});

	it("asks once per step, never twice at once", async () => {
		const learner = learnerOf([]);
		const f = fixture(learner);

		for (let i = 0; i < 4; i++) await f.step(`(+ ${i} 1)`);

		expect(learner.seen).toHaveLength(4);
		expect(learner.peak).toBe(1);
	});

	it("says nothing below LEARN_AT, and nothing a memory already covers", async () => {
		const quiet = fixture(
			learnerOf([keeping({ worthKeeping: LEARN_AT - 0.1, lesson: 0 })]),
		);
		expect((await quiet.step("(+ 1 2)")).learned).toHaveLength(0);

		const nothing = fixture(learnerOf([keeping({ kind: "nothing" })]));
		expect((await nothing.step("(+ 1 2)")).learned).toHaveLength(0);

		const known = fixture(
			learnerOf([
				keeping({ covered: { key: "acme-url", confidence: COVERED_AT + 0.1 } }),
			]),
		);
		expect((await known.step("(+ 1 2)")).learned).toHaveLength(0);
	});
});

describe("forgetting what a step contradicted", () => {
	it("drops a contradicted memory when the judge is calibrated", async () => {
		const f = fixture(
			learnerOf([
				keeping({
					worthKeeping: 0,
					kind: "nothing",
					stale: { key: "acme-verb", confidence: FORGET_AT + 0.1 },
				}),
			]),
		);
		await runAsync(f.interp, '(memory/remember "acme-verb" "it is navigate")');

		const ran = await f.step("(+ 1 2)");

		expect(notes(ran)).toContain("acme-verb is gone");
		expect(ran.judged.at(-1)?.did).toContain("dropped");
		expect(await f.bank.store.get("acme-verb")).toBeUndefined();
	});

	it("only halves an uncalibrated judge's contradiction", async () => {
		const f = fixture(
			learnerOf([
				keeping({
					worthKeeping: 0,
					kind: "nothing",
					calibrated: false,
					stale: { key: "acme-verb", confidence: FORGET_AT + 0.1 },
				}),
			]),
		);
		await runAsync(f.interp, '(memory/remember "acme-verb" "it is navigate")');

		await f.step("(+ 1 2)");

		const memory = await f.bank.store.get("acme-verb");
		expect(memory).toBeDefined();
		if (memory === undefined) return;
		expect(f.bank.strength(memory)).toBeCloseTo(INITIAL_SCORE / 2);
	});

	it("halves and keeps between SUSPECT_AT and FORGET_AT", async () => {
		const f = fixture(
			learnerOf([
				keeping({
					worthKeeping: 0,
					kind: "nothing",
					stale: { key: "acme-verb", confidence: (SUSPECT_AT + FORGET_AT) / 2 },
				}),
			]),
		);
		await runAsync(f.interp, '(memory/remember "acme-verb" "it is navigate")');

		await f.step("(+ 1 2)");
		await f.step("(+ 2 3)");

		const memory = await f.bank.store.get("acme-verb");
		expect(memory).toBeDefined();
		if (memory === undefined) return;
		expect(f.bank.strength(memory)).toBeCloseTo(INITIAL_SCORE / 2);
	});

	it("leaves a memory alone below SUSPECT_AT", async () => {
		const f = fixture(
			learnerOf([
				keeping({
					worthKeeping: 0,
					kind: "nothing",
					stale: { key: "acme-verb", confidence: SUSPECT_AT - 0.1 },
				}),
			]),
		);
		await runAsync(f.interp, '(memory/remember "acme-verb" "it is navigate")');

		await f.step("(+ 1 2)");
		await f.step("(+ 2 3)");

		const memory = await f.bank.store.get("acme-verb");
		expect(memory).toBeDefined();
		if (memory === undefined) return;
		expect(f.bank.strength(memory)).toBeCloseTo(INITIAL_SCORE);
	});
});

describe("the veto", () => {
	it("refuses a memory that will not be true in another session", async () => {
		const f = fixture(
			learnerOf([], { durable: 0.1, copied: 0, calibrated: true }),
		);

		await expect(
			runAsync(f.interp, '(memory/remember "now" "the file is open")'),
		).rejects.toThrow("this reads as situational");
		expect(await f.bank.store.get("now")).toBeUndefined();
	});

	it("refuses a memory that is the platform describing itself", async () => {
		const f = fixture(
			learnerOf([], { durable: 1, copied: 0.9, calibrated: true }),
		);

		await expect(
			runAsync(
				f.interp,
				'(memory/remember "tools" "acme exposes three tools")',
			),
		).rejects.toThrow("the platform describing itself");
	});

	it("refuses a memory another one already says", async () => {
		const f = fixture(
			learnerOf([], {
				durable: 1,
				copied: 0,
				covered: { key: "acme-url", confidence: COVERED_AT + 0.2 },
				calibrated: true,
			}),
		);

		await expect(
			runAsync(f.interp, '(memory/remember "acme-path" "acme wants a url")'),
		).rejects.toThrow("acme-url already says this; recall it and revise");
	});

	it("advises instead of refusing when the judge is not calibrated", async () => {
		const f = fixture(
			learnerOf([], { durable: 0.1, copied: 0, calibrated: false }),
		);

		const ran = await f.step('(memory/remember "now" "the file is open")');

		expect(notes(ran)).toContain("this reads as situational");
		expect(await f.bank.store.get("now")).toBeDefined();
	});

	it("shows the learner what is already stored", async () => {
		const learner = learnerOf([], {
			durable: 1,
			copied: 0,
			calibrated: true,
		});
		const f = fixture(learner);
		await runAsync(f.interp, '(memory/remember "acme-url" "acme wants a url")');

		await runAsync(
			f.interp,
			'(memory/remember "acme-verb" "browser_navigate")',
		);

		expect(learner.proposed.at(-1)).toEqual({
			key: "acme-verb",
			body: "browser_navigate",
			known: [{ key: "acme-url", body: "acme wants a url" }],
		});
	});
});

describe("a learner that says nothing", () => {
	it("changes no behaviour when it answers undefined", async () => {
		const f = fixture(learnerOf([undefined, undefined]));

		expect((await f.step("(+ 1 2)")).learned).toHaveLength(0);
		expect((await f.step("(+ 2 3)")).learned).toHaveLength(0);
	});

	it("changes no behaviour when it throws", async () => {
		const angry: Learner = {
			consider() {
				throw new Error("no judge today");
			},
			vet() {
				throw new Error("no judge today");
			},
		};
		const f = fixture(angry);

		expect((await f.step('(memory/remember "k" "b")')).learned).toHaveLength(0);
		expect((await f.step("(+ 2 3)")).learned).toHaveLength(0);
		expect(await f.bank.store.get("k")).toBeDefined();
	});
});

describe("what the judge is asked", () => {
	function capture(): { judge: Judge; asked: JudgeRequest[] } {
		const asked: JudgeRequest[] = [];
		return {
			asked,
			judge: async (req) => {
				asked.push(req);
				return { model: "fake", answers: {}, calibrated: true };
			},
		};
	}

	function observedOf(over: Partial<Observed> = {}): Observed {
		return {
			said: "the acme browser tool keeps failing",
			recent: [
				{
					ran: '(mcp/call "acme" "navigate" "https://x.test")',
					prose: "let me drive the browser",
					output: "error: no tool named navigate on acme",
					failed: true,
				},
				{
					ran: '(mcp/tools "acme")',
					prose: "checking what it actually exposes",
					output: "(browser_navigate browser_click)",
					failed: false,
				},
			],
			surfaced: [],
			known: [{ key: "acme-url", body: "acme tools take a full url" }],
			...over,
		};
	}

	it("offers the memories it knows as the covered and stale candidates", async () => {
		const { judge, asked } = capture();

		await judgeLearner(judge).consider(observedOf());

		const questions = asked[0].questions as Record<string, Question>;
		expect(Object.keys(questions)).toContain("covered");
		const covered = questions.covered;
		expect(covered.type).toBe("choice");
		if (covered.type !== "choice") return;
		expect(Object.keys(covered.criteria)).toEqual(["acme-url", "none"]);
		const stale = questions.stale;
		expect(stale.type).toBe("choice");
		if (stale.type !== "choice") return;
		expect(Object.keys(stale.criteria)).toEqual(["acme-url", "none"]);
	});

	it("enumerates the forms that ran, the ones that worked first", async () => {
		const { judge, asked } = capture();

		await judgeLearner(judge).consider(observedOf());

		const forms = (asked[0].questions as Record<string, Question>)
			.procedure_form;
		expect(forms.type).toBe("choice");
		if (forms.type !== "choice") return;
		expect(forms.criteria.f0).toBe('(mcp/tools "acme")');
		expect(forms.criteria.f1).toBe(
			'(mcp/call "acme" "navigate" "https://x.test")',
		);
		expect(forms.criteria.none).toBeDefined();
	});

	it("caps the candidate spans it offers", async () => {
		const { judge, asked } = capture();
		const long = Array.from(
			{ length: SPANS_SEEN * 2 },
			(_unused, i) => `sentence number ${i}.`,
		).join(" ");

		await judgeLearner(judge).consider(
			observedOf({
				recent: [{ ran: "(+ 1 2)", prose: long, output: "3", failed: false }],
			}),
		);

		const spans = (asked[0].questions as Record<string, Question>).fact_span;
		expect(spans.type).toBe("choice");
		if (spans.type !== "choice") return;
		expect(Object.keys(spans.criteria)).toHaveLength(SPANS_SEEN + 1);
	});

	it("reads the answers back into a judgment", async () => {
		const judge: Judge = async () => ({
			model: "fake",
			calibrated: true,
			answers: {
				worth_keeping: { type: "noul", noul: 0.9 },
				kind: {
					type: "choice",
					choice: "procedure",
					confidence: 0.8,
					probabilities: { fact: 0.1, procedure: 0.8, nothing: 0.1 },
				},
				procedure_form: {
					type: "choice",
					choice: "f0",
					confidence: 0.7,
					probabilities: { f0: 0.7, f1: 0.2, none: 0.1 },
				},
				stale: {
					type: "choice",
					choice: "acme-url",
					confidence: 0.5,
					probabilities: { "acme-url": 0.85, none: 0.15 },
				},
				covered: {
					type: "choice",
					choice: "none",
					confidence: 0.9,
					probabilities: { "acme-url": 0.1, none: 0.9 },
				},
			},
		});

		const judgment = await judgeLearner(judge).consider(observedOf());

		expect(judgment).toEqual({
			worthKeeping: 0.9,
			kind: "procedure",
			kindConfidence: 0.8,
			candidate: '(mcp/tools "acme")',
			covered: undefined,
			stale: { key: "acme-url", confidence: 0.85 },
			calibrated: true,
		});
	});
});

describe("the threshold sits in the gap jev leaves", () => {
	const KEEP = [0.79, 0.79, 0.75, 0.74, 0.69];
	const SKIP = [0.06, 0.12, 0.16, 0.07, 0.08];
	const PLATFORM = [0.1, 0.14, 0.15, 0.09, 0.1];

	it("clears every measured correction", () => {
		for (const noul of KEEP) expect(noul).toBeGreaterThanOrEqual(LEARN_AT);
	});

	it("clears none of the measured routine work", () => {
		for (const noul of SKIP) expect(noul).toBeLessThan(LEARN_AT);
	});

	it("clears nothing the platform restates on demand", () => {
		for (const noul of PLATFORM) expect(noul).toBeLessThan(LEARN_AT);
	});

	it("sits in the gap rather than on either edge", () => {
		const floor = Math.min(...KEEP);
		const ceiling = Math.max(...SKIP, ...PLATFORM);
		expect(LEARN_AT - ceiling).toBeGreaterThan(0.15);
		expect(floor - LEARN_AT).toBeGreaterThan(0.15);
	});
});

describe("what the watcher is told", () => {
	it("reports a judgment that came back, with how long it took", async () => {
		const f = fixture(learnerOf([keeping()]));

		await f.step("(+ 1 2)");

		const seen = f.watched.filter((one) => one.at === "consider");
		expect(seen[0].failed).toBeUndefined();
		expect(seen[0].judged?.kind).toBe("procedure");
		expect(typeof seen[0].ms).toBe("number");
	});

	it("reports a judgment that threw, rather than swallowing it", async () => {
		const angry: Learner = {
			consider() {
				throw new Error("jev answered 401");
			},
			vet: () => undefined,
		};
		const f = fixture(angry);

		await f.step("(+ 1 2)");

		const seen = f.watched.filter((one) => one.at === "consider");
		expect(seen.length).toBeGreaterThan(0);
		expect(seen[0].failed).toContain("401");
		expect(seen[0].judged).toBeUndefined();
	});

	it("reports a veto and the sentence it refused with", async () => {
		const f = fixture(
			learnerOf([], { durable: 0.1, copied: 0, calibrated: true }),
		);

		await expect(
			runAsync(f.interp, '(memory/remember "now" "the file is open")'),
		).rejects.toThrow("situational");

		const seen = f.watched.filter((one) => one.at === "vet");
		expect(seen).toHaveLength(1);
		expect(seen[0].vetted?.durable).toBe(0.1);
		expect(seen[0].refusal).toContain("situational");
	});
});

describe("a note is a form, not a suggestion", () => {
	it("hands over a remember call with the trigger jev picked", async () => {
		const f = fixture(
			learnerOf([
				keeping({
					kind: "fact",
					candidate: "acme calls its navigation tool browser_navigate",
					trigger: '(call (mcp/call "acme"))',
				}),
			]),
		);

		const text = notes(await f.step("(+ 1 2)"));

		expect(text).toContain('(memory/remember "acme-calls-its-navigation-tool"');
		expect(text).toContain('"acme calls its navigation tool browser_navigate"');
		expect(text).toContain(':on \'(call (mcp/call "acme"))');
	});

	it("quotes a procedure body and does not quote a fact body", async () => {
		const asCode = fixture(
			learnerOf([keeping({ kind: "procedure", candidate: '(acme/go "x")' })]),
		);
		expect(notes(await asCode.step("(+ 1 2)"))).toContain('\'(acme/go "x")');
	});

	it("still asks for one when nothing in the window states it", async () => {
		const f = fixture(learnerOf([keeping({ candidate: undefined })]));

		const text = notes(await f.step("(+ 1 2)"));

		expect(text).toContain("in your own words");
		expect(text).not.toContain('(memory/remember "');
	});

	it("slugs a key out of the body, skipping the small words", () => {
		expect(slugFor("the revenue column is stored in cents, not dollars")).toBe(
			"revenue-column-stored-cents-dollars",
		);
		expect(slugFor("!!!")).toBe("lesson");
	});
});

describe("a note holds the turn open", () => {
	it("refuses to call the step answered, once", async () => {
		const f = fixture(learnerOf([keeping()]));

		await f.step("(+ 1 2)");

		expect(f.bank.takeUnanswered()).toBe(true);
		expect(f.bank.takeUnanswered()).toBe(false);
	});

	it("leaves the turn alone when nothing was worth keeping", async () => {
		const f = fixture(learnerOf([keeping({ kind: "nothing" })]));

		await f.step("(+ 1 2)");

		expect(f.bank.takeUnanswered()).toBe(false);
	});
});

describe("the same lesson is asked for once", () => {
	it("suppresses a candidate it has already handed over", async () => {
		const same = keeping({ kind: "fact", candidate: "acme wants a full url" });
		const f = fixture(learnerOf([same, same, same]));

		const first = await f.step("(+ 1 2)");
		const second = await f.step("(+ 2 3)");
		const third = await f.step("(+ 3 4)");

		expect(first.learned).toHaveLength(1);
		expect(second.learned).toHaveLength(0);
		expect(third.learned).toHaveLength(0);
		expect(second.judged.at(-1)?.repeated).toBe(true);
	});

	it("still hands over a different candidate", async () => {
		const f = fixture(
			learnerOf([
				keeping({ kind: "fact", candidate: "acme wants a full url" }),
				keeping({ kind: "fact", candidate: "linear needs a team id" }),
			]),
		);

		const first = await f.step("(+ 1 2)");
		const second = await f.step("(+ 2 3)");

		expect(first.learned).toHaveLength(1);
		expect(second.learned).toHaveLength(1);
	});
});

describe("the veto tells a description from a correction", () => {
	const COPIED = [0.75, 0.75, 0.78, 0.72, 0.79, 0.78];
	const CORRECTED = [0.49, 0.39, 0.43, 0.48, 0.37, 0.2];

	it("refuses every measured description the platform handed over", () => {
		for (const noul of COPIED) expect(noul).toBeGreaterThanOrEqual(COPIED_AT);
	});

	it("allows every measured correction", () => {
		for (const noul of CORRECTED) expect(noul).toBeLessThan(COPIED_AT);
	});

	it("sits in the gap rather than on either edge", () => {
		expect(Math.min(...COPIED) - COPIED_AT).toBeGreaterThan(0.1);
		expect(COPIED_AT - Math.max(...CORRECTED)).toBeGreaterThan(0.1);
	});
});

describe("wiping the slate", () => {
	it("drops every memory and says how many went", async () => {
		const f = fixture(learnerOf([]));
		await runAsync(f.interp, '(memory/remember "a" "one")');
		await runAsync(f.interp, '(memory/remember "b" "two")');

		expect(str((await runAsync(f.interp, "(memory/wipe)")).value)).toBe("2.0");
		expect(await f.bank.store.all()).toHaveLength(0);
	});

	it("counts nothing when there was nothing", async () => {
		const f = fixture(learnerOf([]));

		expect(str((await runAsync(f.interp, "(memory/wipe)")).value)).toBe("0.0");
	});

	it("lets the gate ask again for a lesson it had already asked for", async () => {
		const same = keeping({ kind: "fact", candidate: "acme wants a full url" });
		const f = fixture(learnerOf([same, same]));

		expect((await f.step("(+ 1 2)")).learned).toHaveLength(1);
		await runAsync(f.interp, "(memory/wipe)");
		expect((await f.step("(+ 2 3)")).learned).toHaveLength(1);
	});
});

describe("the note reaches the model, not just the trace", () => {
	it("lands in the step's model-facing output", async () => {
		const f = fixture(learnerOf([keeping()]));

		const ran = await f.step("(+ 1 2)");

		expect(ran.model).toContain("<learn>");
		expect(ran.model).toContain("memory/remember");
		expect(ran.model.indexOf("<learn>")).toBeGreaterThan(-1);
	});

	it("leaves the output alone when there is nothing to say", async () => {
		const f = fixture(learnerOf([keeping({ kind: "nothing" })]));

		const ran = await f.step("(+ 1 2)");

		expect(ran.model).not.toContain("<learn>");
	});
});
