import { isNumeric, type Numeric } from "@repo/interpreter/arith";
import {
	Cell,
	EvalException,
	Interp,
	LispKeyword,
	newLispKeyword,
	prelude,
	runSync,
	Sym,
	zAny,
	zList,
} from "@repo/interpreter/lisp";
import { z } from "zod";
import type { CheckOutcome, Verdict } from "./report.ts";
import type { Trace, TraceEvent } from "./trace.ts";

type Settled = ":true" | ":false" | ":pending-true" | ":pending-false";

const TRUE = newLispKeyword("true");
const FALSE = newLispKeyword("false");
const PENDING_TRUE = newLispKeyword("pending-true");
const PENDING_FALSE = newLispKeyword("pending-false");

interface Matcher {
	matcher: "any" | "regex" | "contains" | "equals";
	value: string;
}

interface CallArgs {
	positional: unknown[];
	keywords: Record<string, unknown>;
}

const zString = z.string();
const zNumeric = z.custom<Numeric>(isNumeric, "not a number");

function isMatcher(x: unknown): x is Matcher {
	return typeof x === "object" && x !== null && "matcher" in x;
}

interface Positions {
	positions: number[];
}

function isPositions(x: unknown): x is Positions {
	return typeof x === "object" && x !== null && "positions" in x;
}

function toList(items: number[]): Positions {
	return { positions: items };
}

function fromList(value: unknown): number[] {
	if (!isPositions(value))
		throw new EvalException(
			"expected a matcher such as (called …) or (halted), got",
			value,
		);
	return value.positions;
}

const VERDICTS = new Set([
	":true",
	":false",
	":pending-true",
	":pending-false",
]);

function splitArgs(args: unknown[]): { name: string; spec: CallArgs } {
	const name = String(args[0] ?? "");
	const spec: CallArgs = { positional: [], keywords: {} };
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (arg instanceof LispKeyword) {
			spec.keywords[arg.name] = args[i + 1];
			i += 1;
		} else spec.positional.push(arg);
	}
	return { name, spec };
}

function testValue(actual: unknown, expected: unknown): boolean {
	if (isMatcher(expected)) {
		if (expected.matcher === "any") return true;
		const text = typeof actual === "string" ? actual : String(actual);
		if (expected.matcher === "regex")
			return new RegExp(expected.value).test(text);
		if (expected.matcher === "contains") return text.includes(expected.value);
		return text === expected.value;
	}
	return String(actual) === String(expected);
}

function matchesArgs(actual: CallArgs, spec: CallArgs): boolean {
	for (const [key, want] of Object.entries(spec.keywords))
		if (!(key in actual.keywords) || !testValue(actual.keywords[key], want))
			return false;
	const everything = [...actual.positional, ...Object.values(actual.keywords)];
	for (const want of spec.positional)
		if (!everything.some((value) => testValue(value, want))) return false;
	return true;
}

function eventArgs(event: TraceEvent): CallArgs {
	if (event.kind === "tool") return { positional: [], keywords: event.args };
	if (event.kind === "connect")
		return { positional: [event.server], keywords: {} };
	return { positional: [], keywords: {} };
}

function formArgs(rest: unknown): CallArgs {
	const spec: CallArgs = { positional: [], keywords: {} };
	let node = rest;
	while (node instanceof Cell) {
		if (node.car instanceof LispKeyword) {
			const next = node.cdr;
			spec.keywords[node.car.name] =
				next instanceof Cell ? next.car : undefined;
			node = next instanceof Cell ? next.cdr : null;
			continue;
		}
		spec.positional.push(node.car);
		node = node.cdr;
	}
	return spec;
}

function callsWithin(form: unknown, name: string, out: CallArgs[]): void {
	if (!(form instanceof Cell)) return;
	if (form.car instanceof Sym && form.car.name === name)
		out.push(formArgs(form.cdr));
	let node: unknown = form;
	while (node instanceof Cell) {
		callsWithin(node.car, name, out);
		node = node.cdr;
	}
}

function namesPromise(form: unknown, name: string): boolean {
	let node: unknown = form;
	while (node instanceof Cell) {
		const head = node.car;
		if (
			head instanceof Sym &&
			(head.name === name || head.name.startsWith(`${name}-`))
		)
			return true;
		if (namesPromise(head, name)) return true;
		node = node.cdr;
	}
	return false;
}

function awaitsWithin(form: unknown, name: string): boolean {
	if (!(form instanceof Cell)) return false;
	if (form.car instanceof Sym && form.car.name === "await") {
		const inner: CallArgs[] = [];
		callsWithin(form.cdr, name, inner);
		if (inner.length > 0 || namesPromise(form.cdr, name)) return true;
	}
	let node: unknown = form;
	while (node instanceof Cell) {
		if (awaitsWithin(node.car, name)) return true;
		node = node.cdr;
	}
	return false;
}

export class Checks {
	private readonly interp: Interp;
	private readonly latched = new Map<
		string,
		{ verdict: Verdict; step: number }
	>();
	private readonly pending = new Map<string, Settled>();
	private readonly order: string[] = [];
	private pass = new Map<string, Settled>();

	constructor(
		private readonly trace: Trace,
		private readonly source: string,
	) {
		this.interp = new Interp();
		runSync(this.interp, prelude);
		this.install();
		runSync(this.interp, MACROS);
	}

	evaluate(step: number): void {
		this.pass = new Map();
		runSync(this.interp, this.source);
		for (const [name, verdict] of this.pass) {
			if (this.latched.has(name)) continue;
			if (verdict === ":true")
				this.latched.set(name, { verdict: "true", step });
			else if (verdict === ":false")
				this.latched.set(name, { verdict: "false", step });
			else this.pending.set(name, verdict);
		}
	}

	results(): CheckOutcome[] {
		return this.order.map((name) => {
			const latched = this.latched.get(name);
			if (latched)
				return { name, verdict: latched.verdict, step: latched.step };
			return {
				name,
				verdict: this.pending.get(name) === ":pending-true" ? "true" : "false",
			};
		});
	}

	private record(name: string, verdict: Settled): void {
		if (!this.order.includes(name)) this.order.push(name);
		this.pass.set(name, verdict);
	}

	private hits(name: string, spec: CallArgs): number[] {
		const ran: number[] = [];
		const wrote: number[] = [];
		this.trace.events.forEach((event, index) => {
			if (event.kind === "tool" && `${event.server}/${event.tool}` === name) {
				if (matchesArgs(eventArgs(event), spec)) ran.push(index);
				return;
			}
			if (event.kind === "connect" && name === "load-mcp") {
				if (matchesArgs(eventArgs(event), spec)) ran.push(index);
				return;
			}
			if (event.kind === "form") {
				const calls: CallArgs[] = [];
				callsWithin(this.trace.sourceAt(index), name, calls);
				if (calls.some((actual) => matchesArgs(actual, spec)))
					wrote.push(index);
			}
		});
		const dispatched = new Set(ran.map((index) => this.stepOf(index)));
		return [
			...ran,
			...wrote.filter((index) => !dispatched.has(this.stepOf(index))),
		].sort((a, b) => a - b);
	}

	private stepOf(index: number): number {
		return this.trace.events[index]?.step ?? 0;
	}

	private install(): void {
		const interp = this.interp;

		interp.def(
			"_check",
			2,
			"(_check name verdict)",
			"Record one check's verdict for this pass.",
			z.tuple([zAny, zAny]),
			([name, verdict]) => {
				const settled = String(verdict);
				if (!VERDICTS.has(settled))
					throw new EvalException(
						"a check's body must be a combinator such as (eventually …), got",
						verdict,
					);
				this.record(String(name), settled as Settled);
				return verdict;
			},
		);

		interp.def(
			"called",
			-1,
			"(called name &rest args)",
			"Trace positions where name was called, optionally with matching arguments.",
			z.tuple([zList]),
			([args]) => {
				const { name, spec } = splitArgs(fromArgs(args));
				return toList(this.hits(name, spec));
			},
		);

		interp.def(
			"called-any",
			-1,
			"(called-any &rest names)",
			"Trace positions where any of the named things was called.",
			z.tuple([zList]),
			([args]) => {
				const names = fromArgs(args).map(String);
				const seen = new Set<number>();
				for (const name of names)
					for (const index of this.hits(name, {
						positional: [],
						keywords: {},
					}))
						seen.add(index);
				return toList([...seen].sort((a, b) => a - b));
			},
		);

		interp.def(
			"called-server",
			1,
			"(called-server name)",
			"Trace positions where any tool on that MCP server was called.",
			z.tuple([zString]),
			([name]) => toList(this.toolEvents((event) => event.server === name)),
		);

		interp.def(
			"called-server-other-than",
			1,
			"(called-server-other-than name)",
			"Trace positions where a tool on any other MCP server was called.",
			z.tuple([zString]),
			([name]) => toList(this.toolEvents((event) => event.server !== name)),
		);

		interp.def(
			"awaited",
			1,
			"(awaited name)",
			"Trace positions where name, or a result named after it, was awaited.",
			z.tuple([zString]),
			([name]) => {
				const out: number[] = [];
				this.trace.events.forEach((event, index) => {
					if (event.kind !== "form") return;
					if (awaitsWithin(this.trace.sourceAt(index), name)) out.push(index);
				});
				return toList(out);
			},
		);

		interp.def(
			"halted",
			0,
			"(halted)",
			"Trace positions where the agent finished with a prose answer.",
			z.tuple([]),
			() => toList(this.positions((event) => event.kind === "halt")),
		);

		interp.def(
			"answered",
			-1,
			"(answered &rest matchers)",
			"Trace positions where the agent's final answer matched every matcher.",
			z.tuple([zList]),
			([args]) => {
				const wanted = fromArgs(args);
				return toList(
					this.positions(
						(event) =>
							event.kind === "halt" &&
							wanted.every((want) => testValue(event.answer, want)),
					),
				);
			},
		);

		interp.def(
			"errored",
			0,
			"(errored)",
			"Trace positions where a form raised, or the REPL reported an error.",
			z.tuple([]),
			() =>
				toList(
					this.positions(
						(event) =>
							(event.kind === "form" && event.error !== undefined) ||
							(event.kind === "note" && event.severity === "critical"),
					),
				),
		);

		interp.def(
			"skipped",
			0,
			"(skipped)",
			"Trace positions where a form was read as prose and skipped.",
			z.tuple([]),
			() =>
				toList(
					this.positions(
						(event) => event.kind === "note" && event.severity === "warning",
					),
				),
		);

		for (const kind of ["regex", "contains", "equals"] as const)
			interp.def(
				kind === "regex" ? "matches" : kind,
				1,
				`(${kind === "regex" ? "matches" : kind} value)`,
				"An argument matcher for use inside called.",
				z.tuple([zString]),
				([value]) => ({ matcher: kind, value }) as Matcher,
			);

		interp.def(
			"any",
			0,
			"(any)",
			"An argument matcher that accepts any value.",
			z.tuple([]),
			() => ({ matcher: "any", value: "" }) as Matcher,
		);

		interp.def(
			"without",
			2,
			"(without a b)",
			"The positions in a that are not also in b.",
			z.tuple([zAny, zAny]),
			([a, b]) => {
				const drop = new Set(fromList(b));
				return toList(fromList(a).filter((i) => !drop.has(i)));
			},
		);

		interp.def(
			"eventually",
			1,
			"(eventually a)",
			"True once a has happened.",
			z.tuple([zAny]),
			([a]) => (fromList(a).length > 0 ? TRUE : PENDING_FALSE),
		);

		interp.def(
			"never",
			1,
			"(never a)",
			"False once a has happened; true if it never does.",
			z.tuple([zAny]),
			([a]) => (fromList(a).length > 0 ? FALSE : PENDING_TRUE),
		);

		interp.def(
			"always",
			1,
			"(always a)",
			"False once a step goes by without a; true if none does.",
			z.tuple([zAny]),
			([a]) => {
				const steps = new Set(fromList(a).map((i) => this.stepOf(i)));
				for (const step of this.steps()) if (!steps.has(step)) return FALSE;
				return PENDING_TRUE;
			},
		);

		interp.def(
			"before",
			2,
			"(before a b)",
			"Before a happens, b should happen.",
			z.tuple([zAny, zAny]),
			([a, b]) => {
				const first = fromList(a)[0];
				if (first === undefined) return PENDING_FALSE;
				return fromList(b).some((i) => i < first) ? TRUE : FALSE;
			},
		);

		interp.def(
			"requires",
			2,
			"(requires a b)",
			"If a happens at all, b should have happened before it.",
			z.tuple([zAny, zAny]),
			([a, b]) => {
				const first = fromList(a)[0];
				if (first === undefined) return PENDING_TRUE;
				return fromList(b).some((i) => i < first) ? TRUE : FALSE;
			},
		);

		interp.def(
			"after",
			2,
			"(after a b)",
			"After a happens, b should happen.",
			z.tuple([zAny, zAny]),
			([a, b]) => {
				const first = fromList(a)[0];
				if (first === undefined) return PENDING_FALSE;
				return fromList(b).some((i) => i > first) ? TRUE : PENDING_FALSE;
			},
		);

		interp.def(
			"within",
			2,
			"(within n a)",
			"a should happen by step n.",
			z.tuple([zNumeric, zAny]),
			([n, a]) => {
				const limit = Number(n);
				if (fromList(a).some((i) => this.stepOf(i) <= limit)) return TRUE;
				return this.trace.currentStep > limit ? FALSE : PENDING_FALSE;
			},
		);

		interp.def(
			"once",
			1,
			"(once a)",
			"a should happen exactly once.",
			z.tuple([zAny]),
			([a]) => count(fromList(a).length, 1),
		);

		interp.def(
			"at-most",
			2,
			"(at-most a n)",
			"a should happen no more than n times.",
			z.tuple([zAny, zNumeric]),
			([a, n]) => (fromList(a).length > Number(n) ? FALSE : PENDING_TRUE),
		);

		interp.def(
			"happens",
			2,
			"(happens a n)",
			"a should happen exactly n times.",
			z.tuple([zAny, zNumeric]),
			([a, n]) => count(fromList(a).length, Number(n)),
		);
	}

	private positions(keep: (event: TraceEvent) => boolean): number[] {
		const out: number[] = [];
		this.trace.events.forEach((event, index) => {
			if (keep(event)) out.push(index);
		});
		return out;
	}

	private toolEvents(
		keep: (event: TraceEvent & { kind: "tool" }) => boolean,
	): number[] {
		return this.positions((event) => event.kind === "tool" && keep(event));
	}

	private steps(): number[] {
		return [
			...new Set(
				this.trace.events.map((event) => event.step).filter((step) => step > 0),
			),
		];
	}
}

function count(seen: number, want: number): LispKeyword {
	if (seen > want) return FALSE;
	return seen === want ? PENDING_TRUE : PENDING_FALSE;
}

function fromArgs(list: unknown): unknown[] {
	const out: unknown[] = [];
	let node = list;
	while (node instanceof Cell) {
		out.push(node.car);
		node = node.cdr;
	}
	return out;
}

const MACROS = `
(setq defcheck
      (macro (name body)
             (list '_check (list 'quote name) body)))
`;
