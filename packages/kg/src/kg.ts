import { type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import { type Interp, runGen, runSync } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	LispKeyword,
	type List,
	listToArray,
	newLispKeyword,
	newSym,
	quasiquoteSym,
	Sym,
} from "@repo/interpreter/objects";
import { parsePlist } from "@repo/interpreter/plist";
import { zAny, zList, zString } from "@repo/interpreter/schema";
import type { InterpExtension } from "@repo/interpreter/session";
import { z } from "zod";
import {
	BASES,
	type Basis,
	forwardParts,
	Graph,
	predicateFrom,
	printGraph,
	supportFrom,
	supportToLisp,
} from "./graph.ts";
import { DEFAULT_BUDGET, KnowledgeBase, type QueryOptions } from "./kb.ts";
import type { KgHost } from "./ports.ts";
import type { Step } from "./solver.ts";
import {
	functorOf,
	instantiate,
	resolve,
	Trail,
	unify,
	type Var,
	varSymsOf,
} from "./terms.ts";

export const KG_ASKS: readonly string[] = [];

export interface KgExtension extends InterpExtension {
	readonly asks: readonly string[];
}

export function kgExtension(host: KgHost): KgExtension {
	const kb = new KnowledgeBase();
	return Object.assign((interp: Interp): void => registerKg(interp, kb, host), {
		asks: KG_ASKS,
		prompt: host.prompt(),
		memories: host.memories(),
	});
}

const MACROS: [string, string][] = [
	["kg", "kg/open"],
	["fact", "kg/assert"],
	["predicate", "kg/declare"],
	["<-", "kg/rule"],
	["defrule", "kg/defrule"],
	["retract", "kg/retract"],
	["?-", "kg/query"],
	["?all", "kg/all"],
	["why", "kg/why"],
];

const MACRO_DOCS: Record<string, [string, string]> = {
	kg: [
		'(kg "name" [:doc "what it holds"] [:imports ("graph"...)])',
		"Open a graph and use it, creating it when there is none. Every stored graph is the text of a (kg ...) form followed by the forms that fill it.",
	],
	fact: [
		'(fact (predicate arg...) :basis observed :from "doc" :at (:page 3) :quote "exact text" :by "agent" :note "...")',
		"Assert a ground fact into the graph in use, with one support. :basis is observed, user, assumed, proposed or resolved, proposed when left out. Asserting the same fact again adds a support. Returns the fact id.",
	],
	predicate: [
		"(predicate name (arg :key :type string) arg...)",
		"Declare a predicate: its arguments, which of them form its key, and their types (any string number symbol list). Two facts that agree on the key and differ elsewhere are a conflict, and both are kept out of inference until one is retracted.",
	],
	"<-": [
		"(<- (head ?x...) goal...)",
		"Add a backward rule to the graph in use: head holds when every goal holds. Returns the rule id.",
	],
	defrule: [
		"(defrule name premise... => conclusion...)",
		"Add a forward rule to the graph in use. Every solution of the premises derives each conclusion: a fact, or a (<- head goal...) rule. Derived facts are recomputed whenever a fact or rule changes, so they hold only while their premises do.",
	],
	retract: [
		'(retract (predicate pattern...) [:from "doc"])',
		"Remove the supports of every fact in the graph in use that matches the pattern, only those from doc with :from. A fact with no support left is gone. Returns the number of supports removed.",
	],
	"?-": [
		"(?- goal... [:basis (observed user)] [:budget n])",
		"Prove the goals over every graph. Returns the first solution as an alist ((?x . value)...), t when the goals hold with no variable, nil when they fail.",
	],
	"?all": [
		"(?all (?x ?y) goal... [:limit n] [:basis (observed)] [:budget n])",
		"Every solution of the goals, as a list of (x y) rows, or of bare values when the first argument is one ?variable.",
	],
	why: [
		"(why goal...)",
		"The proof of the first solution, as a tree: each node is the goal with :fact and its supports, :derived with the forward rule and its premises, or :rule with its subproofs.",
	],
};

function quasi(x: unknown): Cell {
	return arrayToList([quasiquoteSym, x]) as Cell;
}

function splitOptions(items: unknown[]): [unknown[], List] {
	const at = items.findIndex((x) => x instanceof LispKeyword);
	if (at < 0) return [items, null];
	return [items.slice(0, at), arrayToList(items.slice(at))];
}

function queryOptions(options: List): QueryOptions & { limit?: number } {
	const opts = parsePlist(options);
	for (const name of opts.keys())
		if (!["basis", "budget", "limit"].includes(name))
			throw new EvalException(
				"unknown query option; expected one of :basis :budget :limit",
				newLispKeyword(name),
			);
	const out: QueryOptions & { limit?: number } = { budget: DEFAULT_BUDGET };
	const budget = opts.get("budget");
	if (budget !== undefined) out.budget = Number(budget);
	const limit = opts.get("limit");
	if (limit !== undefined) out.limit = Number(limit);
	const basis = opts.get("basis");
	if (basis !== undefined) {
		const names = basis instanceof Sym ? [basis] : listToArray(basis as List);
		out.basis = names.map((b) => {
			const found = BASES.find((known) => b instanceof Sym && b.name === known);
			if (found === undefined)
				throw new EvalException(
					`unknown basis; expected one of ${BASES.join(" ")}`,
					b,
				);
			return found as Basis;
		});
	}
	return out;
}

function supportsList(
	supports: readonly ReturnType<typeof supportFrom>[],
): List {
	return arrayToList(supports.map(supportToLisp));
}

class RuleNode {
	readonly children: ProofNode[] = [];
	constructor(
		readonly term: unknown,
		readonly id: string,
	) {}
}

type ProofNode = RuleNode | unknown;

function proofToLisp(node: ProofNode): unknown {
	if (!(node instanceof RuleNode)) return node;
	return arrayToList([
		node.term,
		newLispKeyword("rule"),
		node.id,
		...node.children.map(proofToLisp),
	]);
}

export function registerKg(
	interp: Interp,
	kb: KnowledgeBase,
	host: KgHost,
): void {
	const seen = new Map<string, string>();

	function* load(): Eval<void> {
		if (kb.loading) return;
		const stored = yield* settled(host.store.all());
		const present = new Set(stored.map((g) => g.name));
		for (const name of [...seen.keys()])
			if (!present.has(name) && !kb.dirty.has(name)) {
				kb.forget(name);
				seen.delete(name);
			}
		const active = kb.active;
		for (const { name, source } of stored) {
			if (seen.get(name) === source || kb.dirty.has(name)) continue;
			kb.loading = true;
			try {
				yield* runGen(interp, source);
			} catch (ex) {
				throw new EvalException(
					`graph ${name} does not load: ${String(ex)}`,
					name,
				);
			} finally {
				kb.loading = false;
			}
			seen.set(name, source);
		}
		kb.active =
			active !== undefined && kb.graphs.has(active) ? active : undefined;
	}

	function* flush(): Eval<void> {
		for (const name of kb.removed) {
			yield* settled(host.store.remove(name));
			seen.delete(name);
		}
		kb.removed.clear();
		for (const name of kb.dirty) {
			const graph = kb.graphs.get(name);
			if (graph === undefined) continue;
			const source = printGraph(graph);
			yield* settled(host.store.put({ name, source }));
			seen.set(name, source);
		}
		kb.dirty.clear();
	}

	interp.hooks.evalForm.use(function* (i, form, next): Eval {
		try {
			return yield* next(i, form);
		} finally {
			if (kb.dirty.size > 0 || kb.removed.size > 0) yield* flush();
		}
	});

	const def = (
		name: string,
		arity: number,
		signature: string,
		doc: string,
		schema: z.ZodType,
		body: (args: never) => Eval,
	) => interp.defGen(name, arity, signature, doc, schema, body as never);

	def(
		"kg/open",
		1,
		'(kg/open \'("name" [:doc "..."] [:imports ("graph"...)]))',
		"The function behind kg.",
		z.tuple([zList]),
		function* ([items]: [List]): Eval {
			yield* load();
			const [name, ...options] = listToArray(items);
			if (typeof name !== "string" || name.trim() === "")
				throw new EvalException(
					"a graph name must be a non-empty string",
					name ?? null,
				);
			if (kb.loading || !kb.graphs.has(name)) {
				const graph = new Graph(name);
				const opts = parsePlist(arrayToList(options));
				const doc = opts.get("doc");
				if (typeof doc === "string") graph.doc = doc;
				for (const imported of listToArray(
					(opts.get("imports") ?? null) as List,
				))
					if (typeof imported === "string") graph.imports.push(imported);
				kb.graphs.set(name, graph);
				kb.changed(name);
			}
			kb.active = name;
			return name;
		},
	);

	def(
		"kg/new",
		-2,
		'(kg/new "name" [:doc "what it holds"])',
		"Create a graph and use it: every fact and rule written after goes into it. Returns the name.",
		z.tuple([zString, zList]),
		function* ([name, options]: [string, List]): Eval {
			yield* load();
			if (name.trim() === "")
				throw new EvalException("a graph name must not be empty", name);
			if (kb.graphs.has(name))
				throw new EvalException(
					'graph already exists; (kg/use "name") to write into it',
					name,
				);
			const graph = new Graph(name);
			const doc = parsePlist(options).get("doc");
			if (typeof doc === "string") graph.doc = doc;
			kb.graphs.set(name, graph);
			kb.active = name;
			kb.changed(name);
			return name;
		},
	);

	def(
		"kg/use",
		1,
		'(kg/use "name")',
		"Write into an existing graph from now on. Queries always see every graph. Returns the name.",
		z.tuple([zString]),
		function* ([name]: [string]): Eval {
			yield* load();
			kb.graph(name);
			kb.active = name;
			return name;
		},
	);

	def(
		"kg/list",
		0,
		"(kg/list)",
		"Every graph as (name :doc doc :imports (...) :facts n :rules n :forward n), the one in use marked :active t.",
		z.tuple([]),
		function* (): Eval {
			yield* load();
			return arrayToList(
				[...kb.graphs.values()].map((g) =>
					arrayToList([
						g.name,
						newLispKeyword("doc"),
						g.doc ?? null,
						newLispKeyword("imports"),
						arrayToList(g.imports),
						newLispKeyword("facts"),
						BigInt(g.facts.size),
						newLispKeyword("rules"),
						BigInt(g.rules.size),
						newLispKeyword("forward"),
						BigInt(g.forward.size),
						newLispKeyword("active"),
						kb.active === g.name ? true : null,
					]),
				),
			);
		},
	);

	def(
		"kg/drop",
		1,
		'(kg/drop "name")',
		"Delete a graph with everything in it. Returns t.",
		z.tuple([zString]),
		function* ([name]: [string]): Eval {
			yield* load();
			kb.graph(name);
			kb.forget(name);
			kb.dirty.delete(name);
			kb.removed.add(name);
			return true;
		},
	);

	def(
		"kg/import",
		1,
		'(kg/import "name")',
		"Record that the graph in use builds on another graph, such as the graph of one document under a topic graph. Returns the imports.",
		z.tuple([zString]),
		function* ([name]: [string]): Eval {
			yield* load();
			kb.graph(name);
			const graph = kb.current();
			if (name === graph.name)
				throw new EvalException("a graph cannot import itself", name);
			if (!graph.imports.includes(name)) graph.imports.push(name);
			kb.changed(graph.name);
			return arrayToList(graph.imports);
		},
	);

	def(
		"kg/source",
		1,
		'(kg/source "name")',
		"The graph as the text it is stored as.",
		z.tuple([zString]),
		function* ([name]: [string]): Eval {
			yield* load();
			return printGraph(kb.graph(name));
		},
	);

	def(
		"kg/assert",
		1,
		"(kg/assert '((predicate arg...) :basis basis ...))",
		"The function behind fact, for a term built at run time.",
		z.tuple([zList]),
		function* ([items]: [List]): Eval {
			yield* load();
			const [term, ...options] = listToArray(items);
			const graph = kb.current();
			kb.check(term);
			const fact = graph.addFact(term, supportFrom(arrayToList(options)));
			kb.changed(graph.name);
			return fact.id;
		},
	);

	def(
		"kg/declare",
		1,
		"(kg/declare '(name arg...))",
		"The function behind predicate.",
		z.tuple([zList]),
		function* ([items]: [List]): Eval {
			yield* load();
			const [name, ...specs] = listToArray(items);
			const args = predicateFrom(name, specs);
			const pname = (name as Sym).name;
			const elsewhere = kb.predicate(pname);
			const graph = kb.current();
			if (elsewhere !== undefined && elsewhere.graph !== graph.name)
				throw new EvalException(
					`${pname} is already declared in graph ${elsewhere.graph}; reuse it`,
					name,
				);
			graph.predicates.set(pname, { name: pname, graph: graph.name, args });
			kb.changed(graph.name);
			return name;
		},
	);

	def(
		"kg/rule",
		1,
		"(kg/rule '(head goal...))",
		"The function behind <-.",
		z.tuple([zList]),
		function* ([items]: [List]): Eval {
			yield* load();
			const [head, ...body] = listToArray(items);
			const graph = kb.current();
			const rule = graph.addRule(head, body);
			kb.changed(graph.name);
			return rule.id;
		},
	);

	def(
		"kg/defrule",
		1,
		"(kg/defrule '(name premise... => conclusion...))",
		"The function behind defrule.",
		z.tuple([zList]),
		function* ([items]: [List]): Eval {
			yield* load();
			const [name, ...parts] = listToArray(items);
			if (!(name instanceof Sym))
				throw new EvalException("a forward rule name must be a symbol", name);
			const [premises, conclusions] = forwardParts(parts);
			const graph = kb.current();
			graph.addForward(name.name, premises, conclusions);
			kb.changed(graph.name);
			return name;
		},
	);

	def(
		"kg/unrule",
		1,
		'(kg/unrule "id-or-name")',
		"Remove a backward rule by its id, or a forward rule by its name, from the graph in use. Returns t, or nil when there is none.",
		z.tuple([zAny]),
		function* ([id]: [unknown]): Eval {
			yield* load();
			const key = id instanceof Sym ? id.name : String(id);
			const graph = kb.current();
			const gone = graph.rules.delete(key) || graph.forward.delete(key);
			if (gone) kb.changed(graph.name);
			return gone ? true : null;
		},
	);

	def(
		"kg/retract",
		1,
		'(kg/retract \'(pattern [:from "doc"]))',
		"The function behind retract.",
		z.tuple([zList]),
		function* ([items]: [List]): Eval {
			yield* load();
			const [pattern, ...options] = listToArray(items);
			const from = parsePlist(arrayToList(options)).get("from");
			const graph = kb.current();
			let removed = 0;
			for (const fact of [...graph.facts.values()]) {
				const trail = new Trail();
				if (!unify(instantiate(pattern, new Map()), fact.term, trail)) continue;
				const kept = fact.supports.filter(
					(s) => from !== undefined && s.from !== from,
				);
				removed += fact.supports.length - kept.length;
				if (kept.length === 0) graph.facts.delete(fact.id);
				else fact.supports = kept;
			}
			if (removed > 0) kb.changed(graph.name);
			return BigInt(removed);
		},
	);

	function* solutions(
		goals: unknown[],
		options: QueryOptions & { limit?: number },
		row: (vars: Map<string, Var>, steps: Step[]) => unknown,
	): Eval<unknown[]> {
		yield* load();
		const vars = new Map<string, Var>();
		const terms = goals.map((g) => instantiate(g, vars));
		for (const term of terms) if (functorOf(term) !== undefined) kb.check(term);
		const rows: unknown[] = [];
		yield* kb.solve(interp, terms, options, (steps) => {
			rows.push(row(vars, steps));
			return options.limit === undefined || rows.length < options.limit;
		});
		return rows;
	}

	def(
		"kg/query",
		1,
		"(kg/query '(goal... [:basis (...)] [:budget n]))",
		"The function behind ?-.",
		z.tuple([zList]),
		function* ([items]: [List]): Eval {
			const [goals, options] = splitOptions(listToArray(items));
			const names = varSymsOf(arrayToList(goals));
			const [first] = yield* solutions(
				goals,
				{ ...queryOptions(options), limit: 1 },
				(vars) =>
					names.length === 0
						? true
						: arrayToList(
								names.map(
									(n) => new Cell(n, resolve(vars.get(n.name) ?? null)),
								),
							),
			);
			return first ?? null;
		},
	);

	def(
		"kg/all",
		1,
		"(kg/all '((?x ?y) goal... [:limit n] [:basis (...)] [:budget n]))",
		"The function behind ?all.",
		z.tuple([zList]),
		function* ([items]: [List]): Eval {
			const [shape, ...rest] = listToArray(items);
			const [goals, options] = splitOptions(rest);
			const single = shape instanceof Sym;
			const names = single ? [shape] : (listToArray(shape as List) as Sym[]);
			const rows = yield* solutions(goals, queryOptions(options), (vars) => {
				const values = names.map((n) => resolve(vars.get(n.name) ?? n));
				return single ? values[0] : arrayToList(values);
			});
			return arrayToList(rows);
		},
	);

	function explainFact(id: string, term: unknown, seen: Set<string>): unknown {
		const base = kb.baseFact(id);
		if (base !== undefined)
			return arrayToList([
				term,
				newLispKeyword("fact"),
				id,
				newLispKeyword("supports"),
				supportsList(base.supports),
			]);
		const derived = kb.derivedFact(id);
		if (derived === undefined || seen.has(id))
			return arrayToList([term, newLispKeyword("fact"), id]);
		seen.add(id);
		const [first] = derived.justifications;
		return arrayToList([
			term,
			newLispKeyword("derived"),
			id,
			newLispKeyword("by"),
			newSym(first.rule),
			newLispKeyword("because"),
			arrayToList(
				first.premises.map((p) =>
					explainFact(
						p,
						kb.baseFact(p)?.term ?? kb.derivedFact(p)?.term ?? null,
						seen,
					),
				),
			),
		]);
	}

	function proofTree(steps: Step[]): List {
		const root: ProofNode[] = [];
		const stack: { depth: number; node: RuleNode }[] = [];
		for (const step of steps) {
			while (stack.length > 0 && stack[stack.length - 1].depth >= step.depth)
				stack.pop();
			const into =
				stack.length > 0 ? stack[stack.length - 1].node.children : root;
			const term = resolve(step.term);
			if (step.by === "not") {
				into.push(arrayToList([term, newLispKeyword("not")]));
			} else if (step.by.kind === "fact") {
				into.push(explainFact(step.by.id, term, new Set()));
			} else {
				const node = new RuleNode(term, step.by.rule.id);
				into.push(node);
				stack.push({ depth: step.depth, node });
			}
		}
		return arrayToList(root.map(proofToLisp));
	}

	def(
		"kg/why",
		1,
		"(kg/why '(goal...))",
		"The function behind why.",
		z.tuple([zList]),
		function* ([items]: [List]): Eval {
			const [goals, options] = splitOptions(listToArray(items));
			const [tree] = yield* solutions(
				goals,
				{ ...queryOptions(options), limit: 1 },
				(_vars, steps) => proofTree(steps),
			);
			return tree ?? null;
		},
	);

	def(
		"kg/facts",
		-2,
		'(kg/facts \'pattern [:graph "name"])',
		"Every fact matching the pattern, stored or derived, as (term :id id :graph name :supports (...)) or (term :id id :derived t :by (rule...)).",
		z.tuple([zAny, zList]),
		function* ([pattern, options]: [unknown, List]): Eval {
			yield* load();
			yield* kb.ready(interp);
			const only = parsePlist(options).get("graph");
			const out: unknown[] = [];
			const matches = (term: unknown) =>
				unify(instantiate(pattern, new Map()), term, new Trail());
			for (const graph of kb.graphs.values()) {
				if (only !== undefined && graph.name !== only) continue;
				for (const fact of graph.facts.values())
					if (matches(fact.term))
						out.push(
							arrayToList([
								fact.term,
								newLispKeyword("id"),
								fact.id,
								newLispKeyword("graph"),
								graph.name,
								newLispKeyword("supports"),
								supportsList(fact.supports),
							]),
						);
			}
			if (only === undefined)
				for (const derived of kb.derived())
					if (matches(derived.term))
						out.push(
							arrayToList([
								derived.term,
								newLispKeyword("id"),
								derived.id,
								newLispKeyword("derived"),
								true,
								newLispKeyword("by"),
								arrayToList([
									...new Set(derived.justifications.map((j) => newSym(j.rule))),
								]),
							]),
						);
			return arrayToList(out);
		},
	);

	def(
		"kg/conflicts",
		0,
		"(kg/conflicts)",
		"Every key that holds two different facts, as (predicate :key (...) :facts ((term :id id :supports (...))...)). The stored facts of a conflict stay out of inference until one is retracted.",
		z.tuple([]),
		function* (): Eval {
			yield* load();
			yield* kb.ready(interp);
			return arrayToList(
				kb.conflicts().map((c) =>
					arrayToList([
						newSym(c.predicate),
						newLispKeyword("key"),
						arrayToList(c.key),
						newLispKeyword("facts"),
						arrayToList(
							c.facts.map((id) => {
								const base = kb.baseFact(id);
								const term = base?.term ?? kb.derivedFact(id)?.term ?? null;
								return arrayToList([
									term,
									newLispKeyword("id"),
									id,
									newLispKeyword("supports"),
									base === undefined ? null : supportsList(base.supports),
								]);
							}),
						),
					]),
				),
			);
		},
	);

	def(
		"kg/saturate",
		-1,
		"(kg/saturate [:budget n])",
		"Run the forward rules to a fixpoint now. Returns how many facts and rules they derive. Queries do this by themselves when anything changed.",
		z.tuple([zList]),
		function* ([options]: [List]): Eval {
			yield* load();
			return BigInt(yield* kb.saturate(interp, queryOptions(options).budget));
		},
	);

	def(
		"kg/expand-do",
		2,
		"(kg/expand-do goals body)",
		"The expansion behind do-solutions.",
		z.tuple([zList, zList]),
		function* ([goals, body]: [List, List]): Eval {
			const names = varSymsOf(goals);
			const row = newSym("kg--row");
			const bindings = names.map((n, i) =>
				arrayToList([n, arrayToList([newSym("nth"), i, row])]),
			);
			return arrayToList([
				newSym("dolist"),
				arrayToList([
					row,
					arrayToList([
						newSym("kg/all"),
						quasi(new Cell(arrayToList(names), goals)),
					]),
				]),
				new Cell(newSym("let"), new Cell(arrayToList(bindings), body)),
			]);
		},
	);

	for (const [name, target] of MACROS) {
		interp.defineGlobal(
			newSym(name),
			runSync(
				interp,
				`(macro (&rest args) (list '${target} (list 'quasiquote args)))`,
			),
			{ signature: MACRO_DOCS[name][0], doc: MACRO_DOCS[name][1] },
		);
	}
	interp.defineGlobal(
		newSym("do-solutions"),
		runSync(interp, "(macro (goals &rest body) (kg/expand-do goals body))"),
		{
			signature: "(do-solutions (goal...) body...)",
			doc: "Run body once per solution of the goals, with every ?variable of the goals bound to its value.",
		},
	);
}
