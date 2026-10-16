import type { Arity, Doc } from "@repo/interpreter/docs";
import { readFailure } from "@repo/interpreter/reader";
import { formSpans } from "@repo/shared/lisp-forms";
import { type CallDoc, diagnosticsForCalls } from "./calls.ts";
import { isSymbol, Walk } from "./scope.ts";
import { type Node, parseForms, tokenizeWithPositions } from "./tokenize.ts";

export interface Defined {
	docs(): Map<string, Doc>;
	arityOf(name: string): Arity | undefined;
	isMacro(name: string): boolean;
	globalNames(): string[];
}

export interface Problem {
	line: number;
	message: string;
	severity: "error" | "warning";
}

function definedHere(nodes: Node[], out = new Set<string>()): Set<string> {
	for (const node of nodes) {
		if (node.kind !== "list" || node.quoted) continue;
		const [head, ...rest] = node.items;
		if (head?.kind === "atom" && !head.quoted) {
			const targets =
				head.text === "setq"
					? rest.filter((_, i) => i % 2 === 0)
					: head.text === "defun" || head.text === "defmacro"
						? rest.slice(0, 1)
						: [];
			for (const target of targets)
				if (target.kind === "atom" && isSymbol(target.text))
					out.add(target.text);
		}
		definedHere(node.items, out);
	}
	return out;
}

function walked(nodes: Node[], defined: Defined): Walk {
	const globals = new Set(defined.globalNames());
	const walk = new Walk(
		{
			isGlobal: (name) => globals.has(name),
			isFunction: (name) =>
				defined.arityOf(name) !== undefined && !defined.isMacro(name),
			isMacro: (name) => defined.isMacro(name),
		},
		definedHere(nodes),
	);
	walk.values(nodes, new Set(), false);
	return walk;
}

export function problemsIn(forms: string, defined: Defined): Problem[] {
	const unreadable = readFailure(forms);
	if (unreadable !== undefined)
		return [
			{
				line: Math.min(unreadable.line, forms.split("\n").length),
				message: unreadable.reason,
				severity: "error",
			},
		];
	const walk = walked(parseForms(tokenizeWithPositions(forms)), defined);
	const calls = walk.calls.map((reached) => reached.call);
	const docs = defined.docs();
	const docByName = new Map<string, CallDoc>(
		calls.map((call) => [
			call.name,
			{ args: docs.get(call.name)?.args, arity: defined.arityOf(call.name) },
		]),
	);
	const misused: Problem[] = diagnosticsForCalls(calls, docByName).map((d) => ({
		line: d.range.start.line + 1,
		message: d.message,
		severity: d.severity,
	}));
	const unbound: Problem[] = walk.unbound.map(({ atom, inBody }) => ({
		line: atom.line + 1,
		message: `${atom.text} is not defined`,
		severity: inBody ? "warning" : "error",
	}));
	return [...misused, ...unbound].sort((a, b) => a.line - b.line);
}

function opensForm(text: string, at: number): boolean {
	const after = text[at + 1] ?? "";
	return (at === 0 || /\s/.test(text[at - 1])) && /[^\s()]/.test(after);
}

export function unclosedIn(code: string): Problem | undefined {
	let found: Problem | undefined;
	formSpans(code, {
		unclosed(text, at) {
			if (found === undefined && opensForm(text, at))
				found = {
					line: text.slice(0, at).split("\n").length,
					message: 'unexpected end of input, this "(" is never closed',
					severity: "error",
				};
			return "unclosed";
		},
		unreadable: () => undefined,
	});
	return found;
}

export function rejection(problems: readonly Problem[]): string {
	return [
		"not run: checked before running and found mistakes.",
		...problems.map((p) => `line ${p.line}: ${p.message}`),
		"fix them, then send the step again.",
	].join("\n");
}
