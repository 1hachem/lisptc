import { topic } from "../../channels.ts";
import {
	Cell,
	type Eval,
	type Interp,
	type InterpExtension,
	type List,
	Sym,
	str,
} from "../../lisp.ts";

export interface GraphReuse {
	name: string;
	from: string;
	step: number;
}

export interface GraphNode {
	id: string;
	step: number;
	index: number;
	head: string | null;
	source: string;
	ok: boolean;
	value?: string;
	error?: string;
	defines: string[];
	reuses: GraphReuse[];
}

export const graphed = topic<GraphNode>("graph");

const SOURCE_LIMIT = 1200;
const VALUE_LIMIT = 300;

const BINDERS = new Set(["setq", "defun", "defmacro"]);
const QUOTES = new Set(["quote", "quasiquote"]);
const LETS = new Set(["let", "let*", "letrec"]);

function clip(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function elements(list: unknown): unknown[] {
	const out: unknown[] = [];
	let node = list;
	while (node instanceof Cell) {
		out.push(node.car);
		node = node.cdr;
	}
	return out;
}

function paramNames(args: unknown): string[] {
	return elements(args)
		.filter((x): x is Sym => x instanceof Sym)
		.map((s) => s.name)
		.filter((name) => !name.startsWith("&"));
}

function definedNames(form: unknown): string[] {
	if (!(form instanceof Cell) || !(form.car instanceof Sym)) return [];
	const head = form.car.name;
	if (!BINDERS.has(head)) return [];
	const args = elements(form.cdr);
	if (head === "setq") {
		const names: string[] = [];
		for (let i = 0; i < args.length; i += 2) {
			const target = args[i];
			if (target instanceof Sym) names.push(target.name);
		}
		return names;
	}
	const name = args[0];
	return name instanceof Sym ? [name.name] : [];
}

function scoped(
	bound: Set<string>,
	names: string[],
	bodies: unknown[],
	into: Set<string>,
): void {
	const inner = new Set([...bound, ...names]);
	for (const body of bodies) collectRefs(body, inner, into);
}

function collectRefs(
	form: unknown,
	bound: Set<string>,
	into: Set<string>,
): void {
	if (form instanceof Sym) {
		if (!bound.has(form.name)) into.add(form.name);
		return;
	}
	if (!(form instanceof Cell)) return;
	if (form.car instanceof Sym) {
		const head = form.car.name;
		if (QUOTES.has(head)) return;
		if (head === "lambda") {
			const cdr = form.cdr as Cell;
			scoped(bound, paramNames(cdr?.car), elements(cdr?.cdr), into);
			return;
		}
		if (head === "defun" || head === "defmacro") {
			const rest = elements(form.cdr);
			const names = [
				...(rest[0] instanceof Sym ? [rest[0].name] : []),
				...paramNames(rest[1]),
			];
			scoped(bound, names, rest.slice(2), into);
			return;
		}
		if (head === "setq") {
			const args = elements(form.cdr);
			for (let i = 1; i < args.length; i += 2)
				collectRefs(args[i], bound, into);
			return;
		}
		if (LETS.has(head)) {
			const args = elements(form.cdr);
			const names: string[] = [];
			for (const binding of elements(args[0])) {
				if (binding instanceof Sym) names.push(binding.name);
				else if (binding instanceof Cell) {
					if (binding.car instanceof Sym) names.push(binding.car.name);
					collectRefs((binding.cdr as Cell)?.car, bound, into);
				}
			}
			scoped(bound, names, args.slice(1), into);
			return;
		}
		into.add(head);
		for (const arg of elements(form.cdr)) collectRefs(arg, bound, into);
		return;
	}
	collectRefs(form.car, bound, into);
	for (const arg of elements(form.cdr as List)) collectRefs(arg, bound, into);
}

export function graphExtension(): InterpExtension {
	return (interp: Interp): void => {
		const definedAt = new Map<string, { id: string; step: number }>();
		let lastStep = 0;
		let index = 0;

		interp.hooks.evalForm.use(function* (i, form, next): Eval {
			const step = i.channels.step;
			if (step <= 0) return yield* next(i, form);

			if (step !== lastStep) {
				lastStep = step;
				index = 0;
			}
			const nodeIndex = index++;
			const id = `${step}.${nodeIndex}`;

			const defines = definedNames(form);
			const refs = new Set<string>();
			collectRefs(form, new Set(), refs);
			const reuses: GraphReuse[] = [];
			for (const name of refs) {
				if (defines.includes(name)) continue;
				const definer = definedAt.get(name);
				if (definer)
					reuses.push({ name, from: definer.id, step: definer.step });
			}

			const head =
				form instanceof Cell && form.car instanceof Sym ? form.car.name : null;
			const base = {
				id,
				step,
				index: nodeIndex,
				head,
				source: clip(str(form), SOURCE_LIMIT),
				defines,
				reuses,
			};
			try {
				const value = yield* next(i, form);
				graphed.emit(i.channels, {
					user: { ...base, ok: true, value: clip(str(value), VALUE_LIMIT) },
				});
				for (const name of defines) definedAt.set(name, { id, step });
				return value;
			} catch (ex) {
				const error = clip(
					ex instanceof Error ? ex.message : String(ex),
					VALUE_LIMIT,
				);
				graphed.emit(i.channels, { user: { ...base, ok: false, error } });
				throw ex;
			}
		});
	};
}
