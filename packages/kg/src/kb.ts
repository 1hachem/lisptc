import type { Eval } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import { arrayToList, Cell, Sym } from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import {
	type Basis,
	type Fact,
	factId,
	type Graph,
	type Predicate,
	type Rule,
	ruleId,
} from "./graph.ts";
import {
	type Clause,
	type FactClause,
	Solver,
	type Step,
	stepsOf,
} from "./solver.ts";
import {
	argsOf,
	functorOf,
	instantiate,
	isGround,
	reify,
	resolve,
	Trail,
	type Var,
	walk,
} from "./terms.ts";

export interface Justification {
	rule: string;
	premises: string[];
}

export interface Derived {
	id: string;
	term: unknown;
	justifications: Justification[];
}

interface DerivedRule {
	rule: Rule;
	justifications: Justification[];
}

export interface Conflict {
	predicate: string;
	key: unknown[];
	facts: string[];
}

export interface QueryOptions {
	budget: number;
	basis?: readonly Basis[];
}

export const DEFAULT_BUDGET = 100_000;
const SATURATE_ROUNDS = 100;

export class KnowledgeBase {
	readonly graphs = new Map<string, Graph>();
	readonly dirty = new Set<string>();
	readonly removed = new Set<string>();
	active: string | undefined;
	private derivedFacts = new Map<string, Derived>();
	private derivedRules = new Map<string, DerivedRule>();
	private quarantined = new Set<string>();
	private conflictList: Conflict[] = [];
	private stale = true;
	private index: Map<string, Clause[]> | undefined;

	loading = false;

	changed(graph: string): void {
		if (!this.loading) this.dirty.add(graph);
		this.stale = true;
		this.index = undefined;
	}

	forget(graph: string): void {
		this.graphs.delete(graph);
		if (this.active === graph) this.active = undefined;
		this.stale = true;
		this.index = undefined;
	}

	graph(name: string): Graph {
		const graph = this.graphs.get(name);
		if (graph === undefined) throw new EvalException("no such graph", name);
		return graph;
	}

	current(): Graph {
		if (this.active === undefined)
			throw new EvalException(
				'no graph in use; (kg/new "name") or (kg/use "name") first',
				null,
			);
		return this.graph(this.active);
	}

	predicate(name: string): Predicate | undefined {
		for (const graph of this.graphs.values()) {
			const found = graph.predicates.get(name);
			if (found !== undefined) return found;
		}
		return undefined;
	}

	check(term: unknown): void {
		const head = walk(term);
		const name =
			head instanceof Cell && head.car instanceof Sym
				? head.car.name
				: undefined;
		if (name === undefined) return;
		const declared = this.predicate(name);
		if (declared === undefined) return;
		const args = argsOf(term);
		if (args.length !== declared.args.length)
			throw new EvalException(
				`${name} takes ${declared.args.length} arguments: (${name} ${declared.args.map((a) => a.name).join(" ")})`,
				resolve(term),
			);
		declared.args.forEach((arg, i) => {
			const value = walk(args[i]);
			if (!isGround(value) || arg.type === undefined || arg.type === "any")
				return;
			const ok =
				arg.type === "string"
					? typeof value === "string"
					: arg.type === "number"
						? typeof value === "number" || typeof value === "bigint"
						: arg.type === "symbol"
							? value instanceof Sym
							: value === null || value instanceof Cell;
			if (!ok)
				throw new EvalException(
					`${name} argument ${arg.name} must be a ${arg.type}`,
					resolve(value),
				);
		});
	}

	private baseFacts(): Fact[] {
		return [...this.graphs.values()].flatMap((g) => [...g.facts.values()]);
	}

	private findConflicts(facts: { id: string; term: unknown }[]): Conflict[] {
		const groups = new Map<
			string,
			{ predicate: string; key: unknown[]; facts: Map<string, string> }
		>();
		for (const fact of facts) {
			const head = walk(fact.term);
			if (!(head instanceof Cell) || !(head.car instanceof Sym)) continue;
			const declared = this.predicate(head.car.name);
			if (declared === undefined || !declared.args.some((a) => a.key)) continue;
			const args = argsOf(fact.term);
			const key = declared.args.flatMap((a, i) => (a.key ? [args[i]] : []));
			const group = `${declared.name} ${str(arrayToList(key))}`;
			const entry = groups.get(group) ?? {
				predicate: declared.name,
				key,
				facts: new Map(),
			};
			entry.facts.set(str(fact.term), fact.id);
			groups.set(group, entry);
		}
		return [...groups.values()]
			.filter((g) => g.facts.size > 1)
			.map((g) => ({
				predicate: g.predicate,
				key: g.key,
				facts: [...g.facts.values()],
			}));
	}

	private build(basis?: readonly Basis[]): Map<string, Clause[]> {
		const index = new Map<string, Clause[]>();
		const add = (functor: string | undefined, clause: Clause) => {
			if (functor === undefined) return;
			const list = index.get(functor) ?? [];
			list.push(clause);
			index.set(functor, list);
		};
		for (const fact of this.baseFacts()) {
			if (this.quarantined.has(fact.id)) continue;
			if (
				basis !== undefined &&
				!fact.supports.some((s) => basis.includes(s.basis))
			)
				continue;
			add(functorOf(fact.term), { kind: "fact", id: fact.id, term: fact.term });
		}
		if (basis === undefined)
			for (const derived of this.derivedFacts.values())
				add(functorOf(derived.term), {
					kind: "fact",
					id: derived.id,
					term: derived.term,
				});
		for (const graph of this.graphs.values())
			for (const rule of graph.rules.values())
				add(functorOf(rule.head), { kind: "rule", rule });
		for (const { rule } of this.derivedRules.values())
			add(functorOf(rule.head), { kind: "rule", rule });
		return index;
	}

	private sourceFor(basis?: readonly Basis[]) {
		if (basis === undefined && this.index === undefined)
			this.index = this.build();
		const index =
			basis === undefined && this.index !== undefined
				? this.index
				: this.build(basis);
		return {
			candidates: (term: unknown) => index.get(functorOf(term) ?? "") ?? [],
		};
	}

	*ready(interp: Interp, budget = DEFAULT_BUDGET): Eval<void> {
		if (!this.stale) return;
		yield* this.saturate(interp, budget);
	}

	*saturate(interp: Interp, budget = DEFAULT_BUDGET): Eval<number> {
		this.derivedFacts = new Map();
		this.derivedRules = new Map();
		this.conflictList = this.findConflicts(this.baseFacts());
		this.quarantined = new Set(this.conflictList.flatMap((c) => c.facts));
		this.index = undefined;
		this.stale = false;
		const rules = [...this.graphs.values()].flatMap((g) => [
			...g.forward.values(),
		]);
		let spent = 0;
		for (let round = 0; round < SATURATE_ROUNDS; round++) {
			let grew = false;
			for (const rule of rules) {
				const trail = new Trail();
				const solver = new Solver(
					interp,
					this.sourceFor(),
					trail,
					budget - spent,
				);
				const vars = new Map<string, Var>();
				const premises = rule.premises.map((p) => instantiate(p, vars));
				const found: { conclusions: unknown[]; premises: string[] }[] = [];
				yield* solver.run(premises, (log) => {
					found.push({
						conclusions: rule.conclusions.map((c) =>
							reify(instantiate(c, vars)),
						),
						premises: usedFacts(stepsOf(log)),
					});
					return true;
				});
				spent += solver.steps;
				for (const { conclusions, premises: used } of found)
					for (const conclusion of conclusions)
						if (this.derive(conclusion, { rule: rule.id, premises: used }))
							grew = true;
				if (grew) this.index = undefined;
			}
			if (!grew) {
				this.conflictList = this.findConflicts([
					...this.baseFacts(),
					...this.derivedFacts.values(),
				]);
				return this.derivedFacts.size + this.derivedRules.size;
			}
		}
		throw new EvalException(
			`forward rules did not reach a fixpoint in ${SATURATE_ROUNDS} rounds`,
			null,
		);
	}

	private derive(conclusion: unknown, why: Justification): boolean {
		const head = walk(conclusion);
		if (
			head instanceof Cell &&
			head.car instanceof Sym &&
			head.car.name === "<-"
		) {
			const [ruleHead, ...body] = argsOf(head);
			const id = ruleId(ruleHead, body);
			const existing = this.derivedRules.get(id);
			if (existing !== undefined) {
				existing.justifications.push(why);
				return false;
			}
			const graphRule = [...this.graphs.values()].some((g) => g.rules.has(id));
			if (graphRule) return false;
			this.derivedRules.set(id, {
				rule: { id, graph: "", head: ruleHead, body },
				justifications: [why],
			});
			return true;
		}
		if (!isGround(conclusion))
			throw new EvalException(
				"a forward rule concluded a fact with an unbound ?variable",
				conclusion,
			);
		this.check(conclusion);
		const id = factId(conclusion);
		if (this.baseFacts().some((f) => f.id === id)) return false;
		const existing = this.derivedFacts.get(id);
		if (existing !== undefined) {
			if (
				!existing.justifications.some(
					(j) =>
						j.rule === why.rule && j.premises.join() === why.premises.join(),
				)
			)
				existing.justifications.push(why);
			return false;
		}
		this.derivedFacts.set(id, { id, term: conclusion, justifications: [why] });
		return true;
	}

	*solve(
		interp: Interp,
		goals: unknown[],
		options: QueryOptions,
		onSolution: (steps: Step[]) => boolean,
	): Eval<number> {
		yield* this.ready(interp, options.budget);
		const solver = new Solver(
			interp,
			this.sourceFor(options.basis),
			new Trail(),
			options.budget,
		);
		yield* solver.run(goals, (log) => onSolution(stepsOf(log)));
		return solver.steps;
	}

	conflicts(): Conflict[] {
		return this.conflictList;
	}

	derivedFact(id: string): Derived | undefined {
		return this.derivedFacts.get(id);
	}

	baseFact(id: string): Fact | undefined {
		for (const graph of this.graphs.values()) {
			const fact = graph.facts.get(id);
			if (fact !== undefined) return fact;
		}
		return undefined;
	}

	derived(): Derived[] {
		return [...this.derivedFacts.values()];
	}
}

function usedFacts(steps: Step[]): string[] {
	return steps
		.map((s) => s.by)
		.filter((by): by is FactClause => by !== "not" && by.kind === "fact")
		.map((by) => by.id);
}
