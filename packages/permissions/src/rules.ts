import { EvalException } from "@repo/interpreter/errors";
import {
	Cell,
	EndOfFile,
	LispKeyword,
	type List,
	Sym,
} from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import { Reader } from "@repo/interpreter/reader";
import type { Ruling, ServerAccess, Verdict } from "./ports.ts";

interface Rule {
	readonly verdict: Verdict;
	readonly match: RegExp;
	readonly reason?: string;
}

export const RULE_FORMS = [
	"permission/default",
	"permission/allow",
	"permission/deny",
	"permission/ask",
	"permission/server",
	"permission/deny-server",
	"permission/hide-server",
] as const;

const STRENGTH: Record<Verdict, number> = { allow: 0, ask: 1, deny: 2 };

const SERVER_STRENGTH: Record<ServerAccess["access"], number> = {
	open: 0,
	denied: 1,
	hidden: 2,
};

const VERDICTS: readonly string[] = ["allow", "deny", "ask"];

export class PermissionRules {
	constructor(
		readonly source: string,
		readonly forms: readonly Cell[],
		private readonly rules: readonly Rule[],
		private readonly hidden: readonly RegExp[],
		private readonly only: ReadonlyMap<string, readonly RegExp[]>,
		private readonly servers: ReadonlyMap<string, ServerAccess>,
		readonly fallback: Verdict,
	) {}

	decide(name: string): Ruling {
		if (this.hides(name)) return { verdict: "deny", reason: "hidden" };
		return this.named(name) ?? { verdict: this.fallback };
	}

	named(name: string): Ruling | undefined {
		let winner: Rule | undefined;
		for (const rule of this.rules)
			if (
				rule.match.test(name) &&
				(winner === undefined ||
					STRENGTH[rule.verdict] > STRENGTH[winner.verdict])
			)
				winner = rule;
		if (winner === undefined) return undefined;
		return winner.reason === undefined
			? { verdict: winner.verdict }
			: { verdict: winner.verdict, reason: winner.reason };
	}

	server(name: string): ServerAccess {
		return this.servers.get(name) ?? { access: "open" };
	}

	tool(server: string, tool: string): boolean {
		return !this.hides(`${server}/${tool}`);
	}

	with(form: Cell): PermissionRules {
		const text = str(form);
		parseRules(text);
		const source =
			this.source.trim() === ""
				? `${text}\n`
				: `${this.source.trimEnd()}\n${text}\n`;
		return parseRules(source);
	}

	without(form: unknown): PermissionRules {
		const text = str(form);
		const kept = this.forms.filter((held) => str(held) !== text);
		if (kept.length === this.forms.length)
			throw new EvalException("no such permissions form", form, false);
		return parseRules(kept.map((held) => `${str(held)}\n`).join(""));
	}

	private hides(name: string): boolean {
		if (this.hidden.some((pattern) => pattern.test(name))) return true;
		for (const [prefix, shown] of this.only)
			if (name.startsWith(prefix) && !shown.some((p) => p.test(name)))
				return true;
		return false;
	}
}

export function parseRules(source: string): PermissionRules {
	const forms = readForms(source);
	const rules: Rule[] = [];
	const hidden: RegExp[] = [];
	const only = new Map<string, RegExp[]>();
	const servers = new Map<string, ServerAccess>();
	let fallback: Verdict = "allow";
	const restrict = (name: string, access: ServerAccess) => {
		const held = servers.get(name);
		if (
			held === undefined ||
			SERVER_STRENGTH[access.access] > SERVER_STRENGTH[held.access]
		)
			servers.set(name, access);
	};
	for (const form of forms) {
		const [head, args] = split(form);
		switch (head) {
			case "permission/default":
				fallback = verdictOf(single(form, args));
				break;
			case "permission/allow":
			case "permission/deny":
			case "permission/ask":
				rules.push(...ruleSet(form, verdictIn(head), args, ""));
				break;
			case "permission/server":
				readServer(form, args, rules, hidden, only);
				break;
			case "permission/deny-server": {
				const { names, reason } = namesAndReason(form, args);
				for (const name of names)
					restrict(
						name,
						reason === undefined
							? { access: "denied" }
							: { access: "denied", reason },
					);
				break;
			}
			case "permission/hide-server":
				for (const name of namesAndReason(form, args).names)
					restrict(name, { access: "hidden" });
				break;
			default:
				throw new EvalException("unknown permissions form", form, false);
		}
	}
	return new PermissionRules(
		source,
		forms,
		rules,
		hidden,
		only,
		servers,
		fallback,
	);
}

function verdictIn(head: string): Verdict {
	return verdictOf(head.slice("permission/".length));
}

function readServer(
	form: Cell,
	args: unknown[],
	rules: Rule[],
	hidden: RegExp[],
	only: Map<string, RegExp[]>,
): void {
	const [name, ...body] = args;
	if (body.length === 0)
		throw new EvalException("a server form names no rules", form, false);
	const prefix = `${nameOf(form, name)}/`;
	for (const inner of body) {
		if (!(inner instanceof Cell))
			throw new EvalException("bad server rule", inner, false);
		const [head, innerArgs] = split(inner);
		if (head === "hide") {
			for (const pattern of namesAndReason(inner, innerArgs).names)
				hidden.push(glob(prefix + pattern));
		} else if (head === "only") {
			const shown = only.get(prefix) ?? [];
			for (const pattern of namesAndReason(inner, innerArgs).names)
				shown.push(glob(prefix + pattern));
			only.set(prefix, shown);
		} else if (VERDICTS.includes(head)) {
			rules.push(...ruleSet(inner, head as Verdict, innerArgs, prefix));
		} else {
			throw new EvalException("unknown server rule", inner, false);
		}
	}
}

function ruleSet(
	form: Cell,
	verdict: Verdict,
	args: unknown[],
	prefix: string,
): Rule[] {
	const { names, reason } = namesAndReason(form, args);
	return names.map((name) => ({
		verdict,
		match: glob(prefix + name),
		...(reason === undefined ? {} : { reason }),
	}));
}

function namesAndReason(
	form: Cell,
	args: unknown[],
): { names: string[]; reason?: string } {
	const names: string[] = [];
	let reason: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg instanceof LispKeyword) {
			const value = args[i + 1];
			if (arg.name !== "reason" || typeof value !== "string")
				throw new EvalException("bad permissions option", form, false);
			reason = value;
			i++;
		} else {
			names.push(nameOf(form, arg));
		}
	}
	if (names.length === 0)
		throw new EvalException("a permissions form names nothing", form, false);
	return reason === undefined ? { names } : { names, reason };
}

function readForms(source: string): Cell[] {
	const reader = new Reader();
	reader.push(source);
	const forms: Cell[] = [];
	try {
		while (!reader.isEmpty()) {
			const form = reader.read();
			if (form instanceof Cell) forms.push(form);
		}
	} catch (ex) {
		if (ex === EndOfFile)
			throw new EvalException(
				"a permissions config ends inside a form",
				`line ${reader.line}`,
				false,
			);
		throw ex;
	}
	return forms;
}

function split(form: Cell): [string, unknown[]] {
	if (!(form instanceof Cell) || !(form.car instanceof Sym))
		throw new EvalException("bad permissions form", form, false);
	const args: unknown[] = [];
	for (let j = form.cdr as List; j !== null; j = j.cdr as List) {
		if (!(j instanceof Cell))
			throw new EvalException("bad permissions form", form, false);
		args.push(j.car);
	}
	return [form.car.name, args];
}

function single(form: Cell, args: unknown[]): unknown {
	if (args.length !== 1)
		throw new EvalException("bad permissions form", form, false);
	return args[0];
}

function verdictOf(x: unknown): Verdict {
	const name = x instanceof Sym ? x.name : x;
	if (typeof name === "string" && VERDICTS.includes(name))
		return name as Verdict;
	throw new EvalException("a verdict is allow, deny or ask", x, false);
}

function nameOf(form: Cell, x: unknown): string {
	if (x instanceof Sym) return x.name;
	if (typeof x === "string" && x !== "") return x;
	throw new EvalException("a permissions name is a symbol", form, false);
}

const MULTIPLY = /^\*$/;

function glob(pattern: string): RegExp {
	if (pattern === "*") return MULTIPLY;
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
}
