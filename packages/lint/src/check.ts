import type { Arity, Doc } from "@repo/interpreter/docs";
import { readFailure } from "@repo/interpreter/reader";
import { formSpans } from "@repo/shared/lisp-forms";
import { type CallDoc, diagnosticsForCalls } from "./calls.ts";
import {
	type Call,
	callOf,
	type Node,
	parseForms,
	tokenizeWithPositions,
} from "./tokenize.ts";

export interface Defined {
	docs(): Map<string, Doc>;
	arityOf(name: string): Arity | undefined;
	isMacro(name: string): boolean;
}

export interface Problem {
	line: number;
	message: string;
}

const EVALUATES_EVERY_ARGUMENT = new Set([
	"progn",
	"if",
	"and",
	"or",
	"when",
	"unless",
]);

const DEFINES_ITS_FIRST_ARGUMENT = new Set(["defun", "defmacro", "setq"]);

function opensOwnScope(name: string, defined: Defined): boolean {
	if (EVALUATES_EVERY_ARGUMENT.has(name)) return false;
	return defined.arityOf(name) === undefined || defined.isMacro(name);
}

function evaluatedCalls(nodes: Node[], defined: Defined, out: Call[]): Call[] {
	for (const node of nodes) {
		if (node.kind !== "list" || node.quoted) continue;
		const call = callOf(node);
		if (call === undefined) continue;
		out.push(call);
		if (!opensOwnScope(call.name, defined))
			evaluatedCalls(node.items.slice(1), defined, out);
	}
	return out;
}

function definedHere(nodes: Node[], out = new Set<string>()): Set<string> {
	for (const node of nodes) {
		if (node.kind !== "list" || node.quoted) continue;
		const [head, name] = node.items;
		if (
			head?.kind === "atom" &&
			DEFINES_ITS_FIRST_ARGUMENT.has(head.text) &&
			name?.kind === "atom"
		)
			out.add(name.text);
		definedHere(node.items, out);
	}
	return out;
}

export function problemsIn(forms: string, defined: Defined): Problem[] {
	const unreadable = readFailure(forms);
	if (unreadable !== undefined)
		return [
			{
				line: Math.min(unreadable.line, forms.split("\n").length),
				message: unreadable.reason,
			},
		];
	const nodes = parseForms(tokenizeWithPositions(forms));
	const redefined = definedHere(nodes);
	const calls = evaluatedCalls(nodes, defined, []).filter(
		(call) => !redefined.has(call.name),
	);
	const docs = defined.docs();
	const docByName = new Map<string, CallDoc>(
		calls.map((call) => [
			call.name,
			{ args: docs.get(call.name)?.args, arity: defined.arityOf(call.name) },
		]),
	);
	return diagnosticsForCalls(calls, docByName)
		.filter((d) => d.severity === "error")
		.map((d) => ({ line: d.range.start.line + 1, message: d.message }));
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
