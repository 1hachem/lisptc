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

type Special = (
	walk: Walk,
	rest: readonly Node[],
	scope: ReadonlySet<string>,
	inBody: boolean,
) => void;

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

function widened(
	scope: ReadonlySet<string>,
	names: readonly string[],
): ReadonlySet<string> {
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

	private bound(name: string, scope: ReadonlySet<string>): boolean {
		return (
			scope.has(name) ||
			this.definedHere.has(name) ||
			this.known.isGlobal(name) ||
			name.includes("/")
		);
	}

	values(
		nodes: readonly Node[],
		scope: ReadonlySet<string>,
		inBody: boolean,
	): void {
		for (const node of nodes) this.value(node, scope, inBody);
	}

	value(
		node: Node | undefined,
		scope: ReadonlySet<string>,
		inBody: boolean,
	): void {
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

	private form(
		form: ListForm,
		scope: ReadonlySet<string>,
		inBody: boolean,
	): void {
		const [head, ...rest] = form.items;
		if (head === undefined) return;
		if (head.kind === "list") {
			this.values(form.items, scope, inBody);
			return;
		}
		if (head.quoted || !isSymbol(head.text)) return;
		const special = SPECIAL_FORMS.get(head.text);
		if (special !== undefined) special(this, rest, scope, inBody);
		else this.application(form, head.text, scope, inBody);
	}

	private application(
		form: ListForm,
		name: string,
		scope: ReadonlySet<string>,
		inBody: boolean,
	): void {
		const args = form.items.slice(1);
		if (scope.has(name)) {
			this.values(args, scope, inBody);
			return;
		}
		if (!this.evaluatesItsArguments(name)) return;
		this.reach(form, inBody);
		this.values(args, scope, inBody);
	}

	private evaluatesItsArguments(name: string): boolean {
		if (EVALUATES_EVERY_ARGUMENT.has(name)) return true;
		if (this.known.isMacro(name)) return false;
		return this.definedHere.has(name) || this.known.isFunction(name);
	}

	let(
		name: string,
		rest: readonly Node[],
		scope: ReadonlySet<string>,
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

	loop(
		rest: readonly Node[],
		scope: ReadonlySet<string>,
		inBody: boolean,
	): void {
		const spec = asList(rest[0]);
		const [variable, source, result] = spec?.items ?? [];
		this.value(source, scope, inBody);
		const inner = widened(scope, namesIn(variable));
		this.value(result, inner, inBody);
		this.values(rest.slice(1), inner, inBody);
	}

	try(
		rest: readonly Node[],
		scope: ReadonlySet<string>,
		inBody: boolean,
	): void {
		this.value(rest[0], scope, inBody);
		const handler = asList(rest[1]);
		if (handler === undefined) return;
		const [, params, ...body] = handler.items;
		this.values(body, widened(scope, namesIn(params)), inBody);
	}
}

function letForm(name: string): Special {
	return (walk, rest, scope, inBody) => {
		walk.let(name, rest, scope, inBody);
	};
}

function ignored(): void {}

const SPECIAL_FORMS = new Map<string, Special>([
	["quote", ignored],
	["macro", ignored],
	["defmacro", ignored],
	[
		"progn",
		(walk, rest, scope, inBody) => {
			walk.values(rest, scope, inBody);
		},
	],
	[
		"setq",
		(walk, rest, scope, inBody) => {
			walk.values(
				rest.filter((_, i) => i % 2 === 1),
				scope,
				inBody,
			);
		},
	],
	[
		"cond",
		(walk, rest, scope, inBody) => {
			for (const clause of rest)
				walk.values(asList(clause)?.items ?? [], scope, inBody);
		},
	],
	[
		"case",
		(walk, rest, scope, inBody) => {
			walk.value(rest[0], scope, inBody);
			for (const clause of rest.slice(1))
				walk.values(asList(clause)?.items.slice(1) ?? [], scope, inBody);
		},
	],
	[
		"lambda",
		(walk, rest, scope) => {
			walk.values(rest.slice(1), widened(scope, namesIn(rest[0])), true);
		},
	],
	[
		"defun",
		(walk, rest, scope) => {
			walk.values(rest.slice(2), widened(scope, namesIn(rest[1])), true);
		},
	],
	["let", letForm("let")],
	["let*", letForm("let*")],
	["letrec", letForm("letrec")],
	[
		"dolist",
		(walk, rest, scope, inBody) => {
			walk.loop(rest, scope, inBody);
		},
	],
	[
		"dotimes",
		(walk, rest, scope, inBody) => {
			walk.loop(rest, scope, inBody);
		},
	],
	[
		"try",
		(walk, rest, scope, inBody) => {
			walk.try(rest, scope, inBody);
		},
	],
]);
