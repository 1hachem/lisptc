import {
	type Atom,
	type Call,
	callOf,
	type ListForm,
	type Node,
} from "./tokenize.ts";

export interface Known {
	isGlobal(name: string): boolean;
	isFunction(name: string): boolean;
	isMacro(name: string): boolean;
}

export interface Reached {
	call: Call;
	inBody: boolean;
}

export interface Unbound {
	atom: Atom;
	inBody: boolean;
}

type Scope = ReadonlySet<string>;

const EVALUATES_EVERY_ARGUMENT = new Set([
	"if",
	"when",
	"unless",
	"and",
	"or",
	"while",
]);

export function isSymbol(text: string): boolean {
	if (text === "t" || text === "nil" || text === ".") return false;
	if (/^["':`,&]/.test(text)) return false;
	return Number.isNaN(Number(text));
}

function namesIn(node: Node | undefined): string[] {
	if (node === undefined) return [];
	if (node.kind === "atom") return isSymbol(node.text) ? [node.text] : [];
	return node.items.flatMap((item) =>
		item.kind === "atom" && isSymbol(item.text) ? [item.text] : [],
	);
}

function bindingNames(bindings: Node | undefined): string[] {
	if (bindings?.kind !== "list") return [];
	return bindings.items.flatMap((binding) =>
		binding.kind === "atom" ? namesIn(binding) : namesIn(binding.items[0]),
	);
}

function widened(scope: Scope, names: readonly string[]): Scope {
	return names.length === 0 ? scope : new Set([...scope, ...names]);
}

function asList(node: Node | undefined): ListForm | undefined {
	return node?.kind === "list" && !node.quoted ? node : undefined;
}

export class Walk {
	readonly calls: Reached[] = [];
	readonly unbound: Unbound[] = [];

	constructor(
		private readonly known: Known,
		private readonly definedHere: ReadonlySet<string>,
	) {}

	private bound(name: string, scope: Scope): boolean {
		return (
			scope.has(name) ||
			this.definedHere.has(name) ||
			this.known.isGlobal(name) ||
			name.includes("/")
		);
	}

	values(nodes: readonly Node[], scope: Scope, inBody: boolean): void {
		for (const node of nodes) this.value(node, scope, inBody);
	}

	private value(node: Node | undefined, scope: Scope, inBody: boolean): void {
		if (node === undefined || node.quoted) return;
		if (node.kind === "list") {
			this.form(node, scope, inBody);
			return;
		}
		if (isSymbol(node.text) && !this.bound(node.text, scope))
			this.unbound.push({ atom: node, inBody });
	}

	private reach(form: ListForm, inBody: boolean): void {
		const call = callOf(form);
		if (call !== undefined && !this.definedHere.has(call.name))
			this.calls.push({ call, inBody });
	}

	private form(form: ListForm, scope: Scope, inBody: boolean): void {
		const [head, ...rest] = form.items;
		if (head === undefined) return;
		if (head.kind === "list") {
			this.values(form.items, scope, inBody);
			return;
		}
		if (head.quoted || !isSymbol(head.text)) return;
		const name = head.text;
		switch (name) {
			case "quote":
			case "macro":
			case "defmacro":
				return;
			case "progn": {
				this.values(rest, scope, inBody);
				return;
			}
			case "setq": {
				this.values(
					rest.filter((_, i) => i % 2 === 1),
					scope,
					inBody,
				);
				return;
			}
			case "cond":
				for (const clause of rest)
					this.values(asList(clause)?.items ?? [], scope, inBody);
				return;
			case "case":
				this.value(rest[0], scope, inBody);
				for (const clause of rest.slice(1))
					this.values(asList(clause)?.items.slice(1) ?? [], scope, inBody);
				return;
			case "lambda": {
				this.values(rest.slice(1), widened(scope, namesIn(rest[0])), true);
				return;
			}
			case "defun": {
				this.values(rest.slice(2), widened(scope, namesIn(rest[1])), true);
				return;
			}
			case "let":
			case "let*":
			case "letrec": {
				this.let(name, rest, scope, inBody);
				return;
			}
			case "dolist":
			case "dotimes": {
				this.loop(rest, scope, inBody);
				return;
			}
			case "try": {
				this.try(rest, scope, inBody);
				return;
			}
		}
		if (scope.has(name)) {
			this.values(rest, scope, inBody);
			return;
		}
		if (EVALUATES_EVERY_ARGUMENT.has(name)) {
			this.reach(form, inBody);
			this.values(rest, scope, inBody);
			return;
		}
		if (this.known.isMacro(name)) return;
		if (this.definedHere.has(name) || this.known.isFunction(name)) {
			this.reach(form, inBody);
			this.values(rest, scope, inBody);
		}
	}

	private let(
		name: string,
		rest: readonly Node[],
		scope: Scope,
		inBody: boolean,
	): void {
		const bindings = asList(rest[0]);
		const names = bindingNames(bindings);
		const inner = widened(scope, names);
		const initScope = name === "let" ? scope : inner;
		for (const binding of bindings?.items ?? [])
			if (binding.kind === "list")
				this.value(binding.items[1], initScope, inBody);
		this.values(rest.slice(1), inner, inBody);
	}

	private loop(rest: readonly Node[], scope: Scope, inBody: boolean): void {
		const spec = asList(rest[0]);
		const [variable, source, result] = spec?.items ?? [];
		this.value(source, scope, inBody);
		const inner = widened(scope, namesIn(variable));
		this.value(result, inner, inBody);
		this.values(rest.slice(1), inner, inBody);
	}

	private try(rest: readonly Node[], scope: Scope, inBody: boolean): void {
		this.value(rest[0], scope, inBody);
		const handler = asList(rest[1]);
		if (handler === undefined) return;
		const [, params, ...body] = handler.items;
		this.values(body, widened(scope, namesIn(params)), inBody);
	}
}
