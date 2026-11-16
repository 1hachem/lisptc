import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import type { EmbeddingModel } from "@repo/shared/embedding";
import type { JudgeResult, SystemOneModel } from "@repo/shared/system-one";
import { describe, expect, it } from "vitest";
import {
	CLUSTER_SIMILARITY,
	DEFAULT_MIN,
	DUPLICATE_SIMILARITY,
	OUTLIER_SIMILARITY,
	semanticExtension,
} from "../../src/semantic.ts";
import { semanticHost } from "../../src/semantic-host.ts";

const ACCURACY = 0.9;

interface Run {
	value: string;
	ms: number;
	judged: JudgeResult[];
	embedded: number;
}

function repl() {
	const judged: JudgeResult[] = [];
	let embedded = 0;
	const systemOne: SystemOneModel = {
		...semanticHost.systemOne,
		judge: async (req, signal) => {
			const res = await semanticHost.systemOne.judge(req, signal);
			judged.push(res);
			return res;
		},
	};
	const embedder: EmbeddingModel = {
		...semanticHost.embedder,
		embed: async (req, signal) => {
			embedded++;
			return semanticHost.embedder.embed(req, signal);
		},
	};
	const interp = new Interp({
		extensions: [semanticExtension({ ...semanticHost, systemOne, embedder })],
	});
	runSync(interp, prelude);
	return {
		run: async (code: string): Promise<Run> => {
			const before = { judged: judged.length, embedded };
			const started = performance.now();
			const value = str((await runAsync(interp, code)).value);
			return {
				value,
				ms: Math.round(performance.now() - started),
				judged: judged.slice(before.judged),
				embedded: embedded - before.embedded,
			};
		},
	};
}

async function once(code: string): Promise<Run> {
	return repl().run(code);
}

function lisp(text: string): string {
	return JSON.stringify(text);
}

function noul(res: JudgeResult | undefined, id = "q"): number {
	const answer = res?.answers[id];
	if (answer?.type !== "noul") throw new Error(`no yes/no answer for ${id}`);
	return answer.noul;
}

interface Scored {
	name: string;
	label: boolean;
	score: number;
	ms: number;
}

function bestThreshold(rows: Scored[]): { at: number; accuracy: number } {
	const candidates = [...new Set(rows.map((r) => r.score))].sort(
		(a, b) => a - b,
	);
	let best = { at: 0.5, accuracy: 0 };
	for (let i = 0; i <= candidates.length; i++) {
		const lo = candidates[i - 1] ?? 0;
		const hi = candidates[i] ?? 1;
		const at = (lo + hi) / 2;
		const accuracy = accuracyAt(rows, at);
		if (accuracy > best.accuracy) best = { at, accuracy };
	}
	return best;
}

function accuracyAt(rows: Scored[], at: number): number {
	return rows.filter((r) => r.score >= at === r.label).length / rows.length;
}

function report(form: string, rows: Scored[], at: number): void {
	const best = bestThreshold(rows);
	const lines = [...rows]
		.sort((a, b) => b.score - a.score)
		.map(
			(r) =>
				`  ${r.score >= at === r.label ? "  " : "✗ "}${r.label ? "+" : "-"} ${r.score.toFixed(3)}  ${r.ms}ms  ${r.name}`,
		);
	console.log(
		[
			`${form}: accuracy ${accuracyAt(rows, at).toFixed(2)} at ${at}; best ${best.accuracy.toFixed(2)} at ${best.at.toFixed(3)}`,
			...lines,
		].join("\n"),
	);
}

type Case = [code: string, label: boolean];

async function scoreEach(
	cases: Case[],
	score: (run: Run) => number,
): Promise<Scored[]> {
	return Promise.all(
		cases.map(async ([code, label]) => {
			const run = await once(code);
			return { name: code, label, score: score(run), ms: run.ms };
		}),
	);
}

const PERSON = '(list (cons "name" "Ann Lee") (cons "role" "engineer"))';
const PRODUCT = '(list (cons "sku" "A-113") (cons "price" 12))';

const IS_A: Case[] = [
	[`(%is-a ${PERSON} "person data")`, true],
	['(%is-a "ann.lee@example.com" "an email address")', true],
	['(%is-a "2024-03-15" "a date")', true],
	['(%is-a "+33 6 12 34 56 78" "a phone number")', true],
	['(%is-a "SELECT * FROM users WHERE id = 3" "SQL code")', true],
	[`(%is-a ${PRODUCT} "person data")`, false],
	['(%is-a "hello world" "an email address")', false],
	['(%is-a "banana" "a date")', false],
	['(%is-a "The quick brown fox" "a phone number")', false],
	['(%is-a "I like turtles" "SQL code")', false],
];

const ENOUGH: Case[] = [
	[
		'(%enough? "Flight AF123 from Paris to New York on 2026-12-01, passenger Ann Lee, passport X1234567, paid with card ending 4242" "to book the flight")',
		true,
	],
	[
		'(%enough? "Ann Lee, 12 Rue de Rivoli, 75001 Paris, France" "to mail a letter")',
		true,
	],
	[
		'(%enough? "Meeting with Bob on 2026-12-03 at 14:00 in room B2" "to put the meeting in a calendar")',
		true,
	],
	[
		'(%enough? "The reset link was sent to ann@example.com" "to tell the user where the reset link went")',
		true,
	],
	[
		'(%enough? "Paid 120 EUR by card on 2026-11-02" "to say how much was paid and when")',
		true,
	],
	['(%enough? "The order id is 4411." "to book the flight")', false],
	['(%enough? "Ann Lee" "to mail a letter")', false],
	[
		'(%enough? "Meeting with Bob sometime next week" "to put the meeting in a calendar")',
		false,
	],
	[
		'(%enough? "The user forgot their password." "to tell the user where the reset link went")',
		false,
	],
	[
		'(%enough? "An invoice exists." "to say how much was paid and when")',
		false,
	],
];

const CONTAINS: Case[] = [
	[
		'(%string-contains? "I was charged twice, please send my money back" "a refund request")',
		true,
	],
	[
		'(%string-contains? "The app crashes every time I open settings" "a bug report")',
		true,
	],
	[
		'(%string-contains? "Can we move our call to Thursday?" "a scheduling request")',
		true,
	],
	[
		'(%string-contains? "Your service is terrible and I am furious" "anger")',
		true,
	],
	[
		'(%string-contains? "Ich hätte gerne mein Geld zurück" "a refund request")',
		true,
	],
	[
		'(%string-contains? "Thanks, everything works great" "a bug report")',
		false,
	],
	[
		'(%string-contains? "What are your opening hours?" "a refund request")',
		false,
	],
	['(%string-contains? "I love the new design" "anger")', false],
	[
		'(%string-contains? "Please update my billing address" "a scheduling request")',
		false,
	],
	['(%string-contains? "The weather is nice today" "a bug report")', false],
];

const SAME: Case[] = [
	['(%= "Hi there!" "Hello!")', true],
	['(%= "automobile" "car")', true],
	['(%= "I am leaving" "I\'m heading out")', true],
	['(%= "big" "large")', true],
	['(%= "The meeting is cancelled" "The meeting won\'t happen")', true],
	['(%= "Hi there!" "Goodbye!")', false],
	['(%= "car" "bicycle")', false],
	['(%= "hot" "cold")', false],
	['(%= "The meeting is cancelled" "The meeting is moved to Friday")', false],
	['(%= "buy" "sell")', false],
];

const ORDER: [string, string, string][] = [
	["a cat", "a horse", "size"],
	["warm", "scorching", "temperature"],
	["a whisper", "a shout", "loudness"],
	["a snail", "a cheetah", "speed"],
	["a village", "a city", "population"],
];

const LESS: Case[] = [
	...ORDER.map(([a, b, by]): Case => [`(%< "${a}" "${b}" :by "${by}")`, true]),
	...ORDER.map(([a, b, by]): Case => [`(%< "${b}" "${a}" :by "${by}")`, false]),
];

const MEMBER: Case[] = [
	['(%member "a refund" (list "refund request"))', true],
	['(%member "a bug" (list "software defect"))', true],
	['(%member "cancel" (list "terminate my subscription"))', true],
	['(%member "a car" (list "an automobile"))', true],
	['(%member "happy" (list "glad"))', true],
	['(%member "a refund" (list "password reset"))', false],
	['(%member "a bug" (list "feature request"))', false],
	['(%member "a car" (list "a train"))', false],
	['(%member "happy" (list "sad"))', false],
	['(%member "cancel" (list "upgrade my plan"))', false],
];

const FILTER: [string, string, boolean][] = [
	["engineers", "Ann, engineer", true],
	["engineers", "Ann is a software engineer", true],
	["engineers", "Bea, civil engineer", true],
	["engineers", "Carl, accountant", false],
	["engineers", "Dana, sales manager", false],
	["fruits", "mango", true],
	["fruits", "banana", true],
	["fruits", "hammer", false],
	["fruits", "chair", false],
	["urgent", "the site is down for everyone", true],
	["urgent", "a typo on the about page", false],
	["in English", "Good morning everyone", true],
	["in English", "Bonjour tout le monde", false],
];

describe("semantic predicates against labelled cases", () => {
	const predicates: [string, Case[]][] = [
		["%is-a", IS_A],
		["%enough?", ENOUGH],
		["%string-contains?", CONTAINS],
		["%=", SAME],
		["%<", LESS],
	];

	for (const [form, cases] of predicates)
		it(`${form} agrees with the labels at :min ${DEFAULT_MIN}`, async () => {
			const rows = await scoreEach(cases, (run) => noul(run.judged[0]));
			report(form, rows, DEFAULT_MIN);
			expect(accuracyAt(rows, DEFAULT_MIN)).toBeGreaterThanOrEqual(ACCURACY);
		});

	it(`%member agrees with the labels at :min ${DEFAULT_MIN}`, async () => {
		const rows = await scoreEach(MEMBER, (run) => noul(run.judged[0], "q0"));
		report("%member", rows, DEFAULT_MIN);
		expect(accuracyAt(rows, DEFAULT_MIN)).toBeGreaterThanOrEqual(ACCURACY);
	});

	it(`%filter agrees with the labels at :min ${DEFAULT_MIN}`, async () => {
		const groups = new Map<string, [string, string, boolean][]>();
		for (const entry of FILTER)
			groups.set(entry[0], [...(groups.get(entry[0]) ?? []), entry]);
		const rows = (
			await Promise.all(
				[...groups].map(async ([description, entries]) => {
					const items = entries.map(([, item]) => lisp(item)).join(" ");
					const run = await once(
						`(%filter ${lisp(description)} (list ${items}))`,
					);
					return entries.map(
						([, item, label], i): Scored => ({
							name: `${description} / ${item}`,
							label,
							score: noul(run.judged[0], `q${i}`),
							ms: run.ms,
						}),
					);
				}),
			)
		).flat();
		report("%filter", rows, DEFAULT_MIN);
		expect(accuracyAt(rows, DEFAULT_MIN)).toBeGreaterThanOrEqual(ACCURACY);
	});
});

const PARAPHRASES: [string, string][] = [
	["How do I reset my password?", "I forgot my password, how do I change it?"],
	["Where is my invoice?", "I can't find my invoice"],
	["The app crashes on startup", "The application crashes when it launches"],
	["Cancel my subscription", "I want to end my subscription"],
	["What are your opening hours?", "When are you open?"],
	["I was charged twice", "You billed me two times"],
	["Ship it to Paris", "Send it to Paris"],
	["The meeting is cancelled", "The meeting has been called off"],
];

const SAME_TOPIC: [string, string][] = [
	[
		"How do I reset my password?",
		"How do I turn on two-factor authentication?",
	],
	["Where is my invoice?", "Can I pay by bank transfer?"],
	["The app crashes on startup", "The app is slow when scrolling"],
	["Cancel my subscription", "Upgrade my subscription to pro"],
	["What are your opening hours?", "Where is your shop located?"],
	["I was charged twice", "My card was declined"],
	["Ship it to Paris", "How long does shipping take?"],
	["The meeting is cancelled", "The meeting room is booked"],
];

const UNRELATED: [string, string][] = [
	["How do I reset my password?", "The weather is lovely today"],
	["Where is my invoice?", "My cat loves tuna"],
	["The app crashes on startup", "Paris is the capital of France"],
	["Cancel my subscription", "The recipe needs two eggs"],
	["What are your opening hours?", "Photosynthesis turns light into energy"],
	["I was charged twice", "The match ended in a draw"],
	["Ship it to Paris", "Quantum computers use qubits"],
	["The meeting is cancelled", "Bananas are rich in potassium"],
];

async function similarities(pairs: [string, string][]): Promise<number[]> {
	const scores: number[] = [];
	for (const [a, b] of pairs)
		scores.push(
			Number((await once(`(%similarity ${lisp(a)} ${lisp(b)})`)).value),
		);
	return scores;
}

describe("embedding thresholds against labelled pairs", () => {
	it("separates paraphrases from same-topic pairs at the duplicate threshold, and same-topic from unrelated at the cluster threshold", async () => {
		const [paraphrase, topic, unrelated] = await Promise.all([
			similarities(PARAPHRASES),
			similarities(SAME_TOPIC),
			similarities(UNRELATED),
		]);
		const named = (
			pairs: [string, string][],
			scores: number[],
			label: boolean,
		) =>
			pairs.map(
				([a, b], i): Scored => ({
					name: `${a} ~ ${b}`,
					label,
					score: scores[i] ?? 0,
					ms: 0,
				}),
			);
		const duplicates = [
			...named(PARAPHRASES, paraphrase, true),
			...named(SAME_TOPIC, topic, false),
		];
		const clusters = [
			...named(SAME_TOPIC, topic, true),
			...named(UNRELATED, unrelated, false),
		];
		report("%remove-duplicates", duplicates, DUPLICATE_SIMILARITY);
		report("%cluster", clusters, CLUSTER_SIMILARITY);
		report("%outliers", clusters, OUTLIER_SIMILARITY);
		expect(accuracyAt(duplicates, DUPLICATE_SIMILARITY)).toBeGreaterThanOrEqual(
			ACCURACY,
		);
		expect(accuracyAt(clusters, CLUSTER_SIMILARITY)).toBeGreaterThanOrEqual(
			ACCURACY,
		);
		expect(accuracyAt(clusters, OUTLIER_SIMILARITY)).toBeGreaterThanOrEqual(
			ACCURACY,
		);
	});

	it("drops the paraphrases and keeps the rest with %remove-duplicates", async () => {
		const items = [...PARAPHRASES.flat(), "The weather is lovely today"];
		const run = await once(
			`(%remove-duplicates (list ${items.map(lisp).join(" ")}))`,
		);
		expect(run.value).toBe(
			`(${[...PARAPHRASES.map(([a]) => a), "The weather is lovely today"].map(lisp).join(" ")})`,
		);
	});

	it("finds the one unrelated message among support tickets with %outliers", async () => {
		const tickets = [
			"I was charged twice",
			"You billed me two times",
			"My card was declined",
			"Can I pay by bank transfer?",
			"Bananas are rich in potassium",
		];
		const run = await once(`(%outliers (list ${tickets.map(lisp).join(" ")}))`);
		expect(run.value).toBe('("Bananas are rich in potassium")');
	});

	it("routes by nearest example with %choose :examples", async () => {
		const examples =
			'\'((:billing "I was charged twice" "my card was declined") (:technical "the app crashes" "the page will not load") (:account "I forgot my password" "change my email address"))';
		const cases: [string, string][] = [
			["You billed me two times this month", ":billing"],
			["The application freezes on startup", ":technical"],
			["How do I reset my login?", ":account"],
			["Can I get an invoice for my payment?", ":billing"],
			["Nothing loads after the update", ":technical"],
		];
		const picked = await Promise.all(
			cases.map(async ([text]) => {
				const run = await once(
					`(%choose ${lisp(text)} '(:billing :technical :account) :examples ${examples})`,
				);
				return run.value;
			}),
		);
		console.log(
			cases
				.map(
					([text, want], i) =>
						`${picked[i] === want ? "  " : "✗ "}${want} ${picked[i]} ${text}`,
				)
				.join("\n"),
		);
		expect(picked).toEqual(cases.map(([, want]) => want));
	});
});

describe("calls", () => {
	it("answers the same question twice in a session from one call", async () => {
		const { run } = repl();
		const first = await run('(%p "I was charged twice" "is a refund request")');
		const second = await run(
			'(%p "I was charged twice" "is a refund request")',
		);
		expect(second.value).toBe(first.value);
		expect(first.judged).toHaveLength(1);
		expect(second.judged).toHaveLength(0);
	});

	it("gives nearly the same probability across sessions", async () => {
		const runs = await Promise.all(
			Array.from({ length: 5 }, () =>
				once('(%p "I was charged twice, refund me" "is a refund request")'),
			),
		);
		const ps = runs.map((r) => Number(r.value));
		console.log(
			`%p across 5 sessions: ${ps.map((p) => p.toFixed(3)).join(" ")}`,
		);
		expect(Math.max(...ps) - Math.min(...ps)).toBeLessThan(0.1);
	});

	it("answers equal values without a call", async () => {
		const run = await once(
			'(list (%= "car" "car") (%= 2 2.0) (%similarity "a" "a") (%remove-duplicates (list "a" "a")) (%member "x" (list "x")))',
		);
		expect(run.judged).toHaveLength(0);
		expect(run.embedded).toBe(0);
	});

	it("makes one call for a whole list", async () => {
		const items = [
			"site down",
			"typo",
			"login broken",
			"slow page",
			"new logo",
		];
		const sorted = await once(
			`(%sort (list ${items.map(lisp).join(" ")}) :by "urgency" :desc t)`,
		);
		const near = await once(
			`(%sort (list ${items.map(lisp).join(" ")}) :near "outage")`,
		);
		console.log(`%sort :by ${sorted.ms}ms, %sort :near ${near.ms}ms`);
		expect(sorted.judged).toHaveLength(1);
		expect(near.embedded).toBe(1);
	});
});
