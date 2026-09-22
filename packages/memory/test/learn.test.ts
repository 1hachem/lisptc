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
	COVERED_AT,
	FORGET_AT,
	INITIAL_SCORE,
	type Judgment,
	KNOWN_BODY_CHARS,
	KNOWN_SEEN,
	LEARN_AT,
	type Learned,
	type Learner,
	MemoryBank,
	memoryExtension,
	type Observed,
	OUTPUT_CHARS,
	type Proposed,
	RAN_CHARS,
	SAID_CHARS,
	SPANS_SEEN,
	SUSPECT_AT,
	type Vetting,
	VolatileStore,
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
}

interface Fixture {
	interp: Interp;
	bank: MemoryBank;
	step(code: string): Promise<Ran>;
	said(text: string): void;
}

function notes(step: Ran): string {
	return step.learned.map((one) => one.text).join("\n");
}

function fixture(learner: Learner, clock: Clock = frozen): Fixture {
	const store = new VolatileStore();
	const bank = new MemoryBank(store, clock, learner);
	const extension = memoryExtension(
		{ store, clock, learn: learner, prompt: () => "" },
		{ bank },
	);
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	const hooks = openSession([extension]);
	return {
		interp,
		bank,
		async step(code: string): Promise<Ran> {
			const ctx: StepContext = { interp, code, emit: () => {} };
			const buffer = bufferTransport();
			const detach = interp.channels.pipe(buffer);
			let output = "";
			try {
				await hooks.evalStep.run(async (inner) => {
					try {
						output = str((await runAsync(interp, inner.code)).value);
					} catch (ex) {
						output = String(ex);
					}
				}, ctx);
				hooks.stepOutput.run((_inner, out) => out, ctx, {
					model: output,
					user: output,
				});
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
	it("emits the nudge at the next step, never at the one it judged", async () => {
		const f = fixture(learnerOf([keeping()]));

		expect((await f.step("(+ 1 2)")).learned).toHaveLength(0);

		const next = await f.step("(+ 2 3)");

		expect(next.learned.map((one) => one.what)).toEqual(["candidate"]);
		expect(notes(next)).toContain("(procedure)");
		expect(notes(next)).toContain(
			'candidate: (mcp/call "acme" "browser_navigate" url)',
		);
		expect(notes(next)).toContain("memory/remember");
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

	it("runs at most one judgment at a time", async () => {
		const learner = learnerOf([]);
		const f = fixture(learner);

		for (let i = 0; i < 4; i++) await f.step(`(+ ${i} 1)`);

		expect(learner.seen).toHaveLength(4);
		expect(learner.peak).toBe(1);
	});

	it("says nothing below LEARN_AT, and nothing a memory already covers", async () => {
		const quiet = fixture(
			learnerOf([keeping({ worthKeeping: LEARN_AT - 0.1 })]),
		);
		await quiet.step("(+ 1 2)");
		expect((await quiet.step("(+ 2 3)")).learned).toHaveLength(0);

		const nothing = fixture(learnerOf([keeping({ kind: "nothing" })]));
		await nothing.step("(+ 1 2)");
		expect((await nothing.step("(+ 2 3)")).learned).toHaveLength(0);

		const known = fixture(
			learnerOf([
				keeping({ covered: { key: "acme-url", confidence: COVERED_AT + 0.1 } }),
			]),
		);
		await known.step("(+ 1 2)");
		expect((await known.step("(+ 2 3)")).learned).toHaveLength(0);
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

		await f.step("(+ 1 2)");
		const ran = await f.step("(+ 2 3)");

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
		await f.step("(+ 2 3)");

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
			learnerOf([], { durable: 0.1, recomputable: 0, calibrated: true }),
		);

		await expect(
			runAsync(f.interp, '(memory/remember "now" "the file is open")'),
		).rejects.toThrow("this reads as situational");
		expect(await f.bank.store.get("now")).toBeUndefined();
	});

	it("refuses a memory the REPL could recompute", async () => {
		const f = fixture(
			learnerOf([], { durable: 1, recomputable: 0.9, calibrated: true }),
		);

		await expect(
			runAsync(
				f.interp,
				'(memory/remember "tools" "acme exposes three tools")',
			),
		).rejects.toThrow("the REPL can tell you this");
	});

	it("refuses a memory another one already says", async () => {
		const f = fixture(
			learnerOf([], {
				durable: 1,
				recomputable: 0,
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
			learnerOf([], { durable: 0.1, recomputable: 0, calibrated: false }),
		);

		const ran = await f.step('(memory/remember "now" "the file is open")');

		expect(notes(ran)).toContain("this reads as situational");
		expect(await f.bank.store.get("now")).toBeDefined();
	});

	it("shows the learner what is already stored", async () => {
		const learner = learnerOf([], {
			durable: 1,
			recomputable: 0,
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
