import type { Eval } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	listToArray,
	newLispKeyword,
	newSym,
	quoteSym,
	Sym,
} from "@repo/interpreter/objects";
import type { Rule } from "./graph.ts";
import {
	functorOf,
	instantiate,
	resolve,
	type Trail,
	unify,
	Var,
	walk,
} from "./terms.ts";

export interface FactClause {
	kind: "fact";
	id: string;
	term: unknown;
}

export interface RuleClause {
	kind: "rule";
	rule: Rule;
}

export type Clause = FactClause | RuleClause;

export interface ClauseSource {
	candidates(term: unknown): readonly Clause[];
}

export interface Step {
	depth: number;
	term: unknown;
	by: Clause | "not";
}

interface Frame {
	term: unknown;
	cut: number;
	depth: number;
}

type Goals = { frame: Frame; next: Goals } | null;
type Log = { step: Step; prev: Log } | null;

interface State {
	goals: Goals;
	log: Log;
}

type Alt = () => State | null;

interface Choice {
	trail: number;
	alts: Alt[];
	at: number;
}

class BudgetExceeded extends EvalException {
	constructor(limit: number) {
		super(
			"kg/budget: the search took more inference steps than its budget",
			arrayToList([newLispKeyword("kg-budget"), limit]),
		);
	}
}

export function stepsOf(log: Log): Step[] {
	const out: Step[] = [];
	for (let l = log; l !== null; l = l.prev) out.push(l.step);
	return out.reverse();
}

function push(
	terms: readonly unknown[],
	cut: number,
	depth: number,
	next: Goals,
): Goals {
	let goals = next;
	for (let i = terms.length - 1; i >= 0; i--)
		goals = { frame: { term: terms[i], cut, depth }, next: goals };
	return goals;
}

function headName(term: unknown): string | undefined {
	if (term instanceof Sym) return term.name;
	if (term instanceof Cell && walk(term.car) instanceof Sym)
		return (walk(term.car) as Sym).name;
	return undefined;
}

function argList(term: unknown): unknown[] {
	return term instanceof Cell ? listToArray(walk(term.cdr) as Cell | null) : [];
}

function toCode(x: unknown): unknown {
	const t = walk(x);
	if (t instanceof Var)
		throw new EvalException(
			`unbound ${t.name} in a Lisp expression`,
			newSym(t.name),
		);
	if (x instanceof Var) {
		const value = resolve(t);
		return value instanceof Cell || value instanceof Sym
			? arrayToList([quoteSym, value])
			: value;
	}
	if (t instanceof Cell) return new Cell(toCode(t.car), toCode(t.cdr));
	return t;
}

export class Solver {
	steps = 0;

	constructor(
		private readonly interp: Interp,
		private readonly source: ClauseSource,
		private readonly trail: Trail,
		private readonly budget: number,
	) {}

	*run(
		terms: readonly unknown[],
		onSolution: (log: Log) => boolean,
		depth = 0,
	): Eval<void> {
		const choices: Choice[] = [];
		let state: State | null = { goals: push(terms, 0, depth, null), log: null };
		const backtrack = (): State | null => {
			while (choices.length > 0) {
				const choice = choices[choices.length - 1];
				this.trail.undo(choice.trail);
				while (choice.at < choice.alts.length) {
					const alt = choice.alts[choice.at++];
					const next = alt();
					if (next !== null) return next;
					this.trail.undo(choice.trail);
				}
				choices.pop();
			}
			return null;
		};
		const branch = (alts: Alt[]): State | null => {
			choices.push({ trail: this.trail.mark, alts, at: 0 });
			return backtrack();
		};
		while (state !== null) {
			if (state.goals === null) {
				if (!onSolution(state.log)) return;
				state = backtrack();
				continue;
			}
			if (++this.steps > this.budget) throw new BudgetExceeded(this.budget);
			const { frame, next } = state.goals;
			const log = state.log;
			const term = walk(frame.term);
			if (term instanceof Var)
				throw new EvalException(
					`a goal is an unbound variable ${term.name}`,
					newSym(term.name),
				);
			const args = argList(term);
			switch (headName(term)) {
				case "!":
					choices.length = Math.min(choices.length, frame.cut);
					state = { goals: next, log };
					continue;
				case "true":
					state = { goals: next, log };
					continue;
				case "fail":
					state = backtrack();
					continue;
				case "and":
					state = { goals: push(args, frame.cut, frame.depth, next), log };
					continue;
				case "or":
					state = branch(
						args.map((arg) => () => ({
							goals: push([arg], frame.cut, frame.depth, next),
							log,
						})),
					);
					continue;
				case "not": {
					const mark = this.trail.mark;
					let found = false;
					yield* this.run(
						args,
						() => {
							found = true;
							return false;
						},
						frame.depth + 1,
					);
					this.trail.undo(mark);
					state = found
						? backtrack()
						: {
								goals: next,
								log: {
									step: { depth: frame.depth, term, by: "not" },
									prev: log,
								},
							};
					continue;
				}
				case "=":
					state = unify(args[0], args[1], this.trail)
						? { goals: next, log }
						: backtrack();
					continue;
				case "/=": {
					const mark = this.trail.mark;
					const same = unify(args[0], args[1], this.trail);
					this.trail.undo(mark);
					state = same ? backtrack() : { goals: next, log };
					continue;
				}
				case "is": {
					const value = yield* this.interp.evalGen(toCode(args[1]), null);
					state = unify(args[0], value, this.trail)
						? { goals: next, log }
						: backtrack();
					continue;
				}
				case "test": {
					const value = yield* this.interp.evalGen(toCode(args[0]), null);
					state = value === null ? backtrack() : { goals: next, log };
					continue;
				}
			}
			if (functorOf(term) === undefined)
				throw new EvalException(
					"a goal must be (predicate arg...)",
					resolve(term),
				);
			const barrier = choices.length;
			state = branch(
				this.source.candidates(term).map((clause) => () => {
					if (clause.kind === "fact")
						return unify(term, clause.term, this.trail)
							? {
									goals: next,
									log: {
										step: { depth: frame.depth, term, by: clause },
										prev: log,
									},
								}
							: null;
					const vars = new Map<string, Var>();
					const head = instantiate(clause.rule.head, vars);
					if (!unify(term, head, this.trail)) return null;
					const body = clause.rule.body.map((g) => instantiate(g, vars));
					return {
						goals: push(body, barrier, frame.depth + 1, next),
						log: { step: { depth: frame.depth, term, by: clause }, prev: log },
					};
				}),
			);
		}
	}
}
