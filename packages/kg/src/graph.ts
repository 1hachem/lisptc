import { EvalException } from "@repo/interpreter/errors";
import {
	arrayToList,
	Cell,
	LispKeyword,
	type List,
	listToArray,
	newLispKeyword,
	newSym,
	Sym,
} from "@repo/interpreter/objects";
import { parsePlist } from "@repo/interpreter/plist";
import { str } from "@repo/interpreter/print";
import { functorOf, isGround, shortHash, variant } from "./terms.ts";

export const BASES = [
	"observed",
	"user",
	"assumed",
	"proposed",
	"resolved",
] as const;

export type Basis = (typeof BASES)[number];

const SUPPORT_FIELDS = ["basis", "from", "at", "quote", "by", "note"] as const;

export interface Support {
	basis: Basis;
	from?: string;
	at?: unknown;
	quote?: string;
	by?: string;
	note?: string;
}

export interface Fact {
	id: string;
	graph: string;
	term: unknown;
	supports: Support[];
}

export interface Rule {
	id: string;
	graph: string;
	head: unknown;
	body: unknown[];
}

export interface ForwardRule {
	id: string;
	graph: string;
	premises: unknown[];
	conclusions: unknown[];
}

export interface Arg {
	name: string;
	key: boolean;
	type?: string;
}

export interface Predicate {
	name: string;
	graph: string;
	args: Arg[];
}

const TYPES = ["any", "string", "number", "symbol", "list"] as const;

export function factId(term: unknown): string {
	return `f${shortHash(str(term))}`;
}

export function ruleId(head: unknown, body: unknown[]): string {
	return `r${shortHash(variant(arrayToList([head, ...body])))}`;
}

export class Graph {
	doc: string | undefined;
	readonly imports: string[] = [];
	readonly predicates = new Map<string, Predicate>();
	readonly facts = new Map<string, Fact>();
	readonly rules = new Map<string, Rule>();
	readonly forward = new Map<string, ForwardRule>();

	constructor(readonly name: string) {}

	addFact(term: unknown, support: Support): Fact {
		if (!isGround(term))
			throw new EvalException("a fact must be ground, with no ?variable", term);
		if (functorOf(term) === undefined)
			throw new EvalException("a fact must be (predicate arg...)", term);
		const id = factId(term);
		const fact = this.facts.get(id) ?? {
			id,
			graph: this.name,
			term,
			supports: [],
		};
		const same = fact.supports.some(
			(s) => supportText(s) === supportText(support),
		);
		if (!same) fact.supports.push(support);
		this.facts.set(id, fact);
		return fact;
	}

	addRule(head: unknown, body: unknown[]): Rule {
		if (functorOf(head) === undefined)
			throw new EvalException("a rule head must be (predicate arg...)", head);
		const id = ruleId(head, body);
		const rule = { id, graph: this.name, head, body };
		this.rules.set(id, rule);
		return rule;
	}

	addForward(
		name: string,
		premises: unknown[],
		conclusions: unknown[],
	): ForwardRule {
		const rule = { id: name, graph: this.name, premises, conclusions };
		this.forward.set(name, rule);
		return rule;
	}
}

function supportText(s: Support): string {
	return str(supportPlist(s));
}

function supportPlist(s: Support): List {
	const out: unknown[] = [];
	for (const field of SUPPORT_FIELDS) {
		const value = s[field];
		if (value === undefined) continue;
		out.push(
			newLispKeyword(field),
			field === "basis" ? newSym(value as string) : value,
		);
	}
	return arrayToList(out);
}

export function supportToLisp(s: Support): List {
	return supportPlist(s);
}

function basisOf(x: unknown): Basis {
	const name = x instanceof Sym ? x.name : typeof x === "string" ? x : "";
	const basis = BASES.find((b) => b === name);
	if (basis === undefined)
		throw new EvalException(
			`unknown basis; expected one of ${BASES.join(" ")}`,
			x,
		);
	return basis;
}

function optionalString(
	opts: Map<string, unknown>,
	name: string,
): string | undefined {
	const value = opts.get(name);
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string")
		throw new EvalException(`:${name} must be a string`, value);
	return value;
}

export function supportFrom(options: List): Support {
	const opts = parsePlist(options);
	for (const name of opts.keys())
		if (!(SUPPORT_FIELDS as readonly string[]).includes(name))
			throw new EvalException(
				`unknown fact option; expected one of ${SUPPORT_FIELDS.map((f) => `:${f}`).join(" ")}`,
				newLispKeyword(name),
			);
	const support: Support = { basis: basisOf(opts.get("basis") ?? "proposed") };
	const from = optionalString(opts, "from");
	if (from !== undefined) support.from = from;
	if (opts.get("at") !== undefined) support.at = opts.get("at");
	const quote = optionalString(opts, "quote");
	if (quote !== undefined) support.quote = quote;
	const by = optionalString(opts, "by");
	if (by !== undefined) support.by = by;
	const note = optionalString(opts, "note");
	if (note !== undefined) support.note = note;
	return support;
}

export function predicateFrom(name: unknown, specs: unknown[]): Arg[] {
	if (!(name instanceof Sym))
		throw new EvalException("a predicate name must be a symbol", name);
	return specs.map((spec) => {
		if (spec instanceof Sym) return { name: spec.name, key: false };
		if (!(spec instanceof Cell) || !(spec.car instanceof Sym))
			throw new EvalException(
				"a predicate argument is name or (name [:key] [:type type])",
				spec,
			);
		const rest = listToArray(spec.cdr as List);
		const key = rest.some((x) => x instanceof LispKeyword && x.name === "key");
		const typed = rest.findIndex(
			(x) => x instanceof LispKeyword && x.name === "type",
		);
		const arg: Arg = { name: spec.car.name, key };
		if (typed >= 0) {
			const type = rest[typed + 1];
			const known = TYPES.find((t) => type instanceof Sym && type.name === t);
			if (known === undefined)
				throw new EvalException(
					`unknown type; expected one of ${TYPES.join(" ")}`,
					type ?? null,
				);
			arg.type = known;
		}
		return arg;
	});
}

function splitAt(items: unknown[], marker: string): [unknown[], unknown[]] {
	const at = items.findIndex((x) => x instanceof Sym && x.name === marker);
	if (at < 0)
		throw new EvalException(
			`a forward rule is (defrule name premise... ${marker} conclusion...)`,
			arrayToList(items),
		);
	return [items.slice(0, at), items.slice(at + 1)];
}

export function forwardParts(items: unknown[]): [unknown[], unknown[]] {
	const [premises, conclusions] = splitAt(items, "=>");
	if (premises.length === 0 || conclusions.length === 0)
		throw new EvalException(
			"a forward rule needs at least one premise and one conclusion",
			arrayToList(items),
		);
	return [premises, conclusions];
}

function headed(name: string, items: unknown[]): Cell {
	return new Cell(newSym(name), arrayToList(items));
}

export function printGraph(graph: Graph): string {
	const forms: unknown[] = [];
	const header: unknown[] = [graph.name];
	if (graph.doc !== undefined) header.push(newLispKeyword("doc"), graph.doc);
	if (graph.imports.length > 0)
		header.push(newLispKeyword("imports"), arrayToList(graph.imports));
	forms.push(headed("kg", header));
	for (const p of graph.predicates.values())
		forms.push(
			headed("predicate", [
				newSym(p.name),
				...p.args.map((a) =>
					!a.key && a.type === undefined
						? newSym(a.name)
						: arrayToList([
								newSym(a.name),
								...(a.key ? [newLispKeyword("key")] : []),
								...(a.type === undefined
									? []
									: [newLispKeyword("type"), newSym(a.type)]),
							]),
				),
			]),
		);
	for (const fact of graph.facts.values())
		for (const s of fact.supports)
			forms.push(headed("fact", [fact.term, ...listToArray(supportPlist(s))]));
	for (const rule of graph.rules.values())
		forms.push(headed("<-", [rule.head, ...rule.body]));
	for (const rule of graph.forward.values())
		forms.push(
			headed("defrule", [
				newSym(rule.id),
				...rule.premises,
				newSym("=>"),
				...rule.conclusions,
			]),
		);
	return `${forms.map((f) => str(f)).join("\n")}\n`;
}

export function parseGraph(forms: unknown[]): Graph {
	const [first, ...rest] = forms;
	if (
		!(first instanceof Cell) ||
		!(first.car instanceof Sym) ||
		first.car.name !== "kg"
	)
		throw new EvalException(
			'a graph starts with (kg "name" ...)',
			first ?? null,
		);
	const items = listToArray(first.cdr as List);
	const name = items[0];
	if (typeof name !== "string")
		throw new EvalException("a graph name must be a string", name ?? null);
	const graph = new Graph(name);
	const opts = parsePlist(arrayToList(items.slice(1)));
	const doc = opts.get("doc");
	if (typeof doc === "string") graph.doc = doc;
	for (const imported of listToArray((opts.get("imports") ?? null) as List))
		if (typeof imported === "string") graph.imports.push(imported);
	for (const form of rest) {
		if (!(form instanceof Cell) || !(form.car instanceof Sym))
			throw new EvalException("unknown form in a graph", form);
		const args = listToArray(form.cdr as List);
		switch (form.car.name) {
			case "predicate": {
				const [pname, ...specs] = args;
				graph.predicates.set((pname as Sym).name, {
					name: (pname as Sym).name,
					graph: name,
					args: predicateFrom(pname, specs),
				});
				break;
			}
			case "fact":
				graph.addFact(args[0], supportFrom(arrayToList(args.slice(1))));
				break;
			case "<-":
				graph.addRule(args[0], args.slice(1));
				break;
			case "defrule": {
				const [rname, ...parts] = args;
				const [premises, conclusions] = forwardParts(parts);
				graph.addForward((rname as Sym).name, premises, conclusions);
				break;
			}
			default:
				throw new EvalException("unknown form in a graph", form);
		}
	}
	return graph;
}
