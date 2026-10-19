import type { Arity, DocArg } from "@repo/interpreter/docs";
import {
	type Call,
	collectCalls,
	type Node,
	parseForms,
	tokenizeWithPositions,
} from "./tokenize.ts";

export interface Position {
	line: number;
	character: number;
}

export interface Range {
	start: Position;
	end: Position;
}

export interface Diagnostic {
	range: Range;
	message: string;
	severity: "error" | "warning";
	code: "missing-argument" | "arity" | "type";
}

type LiteralKind = "string" | "integer" | "number" | "boolean" | "nil" | "list";

function literalKind(node: Node): LiteralKind | undefined {
	if (node.kind === "list") return node.quoted ? "list" : undefined;
	if (node.quoted) return undefined;
	if (node.text.startsWith('"')) return "string";
	if (node.text === "t") return "boolean";
	if (node.text === "nil") return "nil";
	const n = Number(node.text);
	if (Number.isNaN(n)) return undefined;
	return Number.isInteger(n) ? "integer" : "number";
}

const ACCEPTS: Record<string, readonly LiteralKind[]> = {
	string: ["string"],
	integer: ["integer"],
	boolean: ["boolean", "nil"],
	list: ["list", "nil"],
	alist: ["list", "nil"],
	plist: ["list", "nil"],
};

function literalText(node: Node): string {
	return node.kind === "atom" ? node.text : "a quoted list";
}

function wrongType(arg: DocArg, value: Node): boolean {
	const kind = literalKind(value);
	const accepts = ACCEPTS[arg.type];
	if (kind === undefined || accepts === undefined) return false;
	if (kind === "nil" && !arg.required) return false;
	return !accepts.includes(kind);
}

export interface CallDoc {
	args?: DocArg[];
	arity?: Arity;
}

export function expectedArgs({ min, max }: Arity): string {
	if (max === undefined) return `at least ${min}`;
	return min === max ? `${min}` : `${min}-${max}`;
}

function rangeOf(call: Call): Range {
	return {
		start: { line: call.head.line, character: call.head.char },
		end: { line: call.head.line, character: call.head.char + call.name.length },
	};
}

function error(
	call: Call,
	code: Diagnostic["code"],
	message: string,
): Diagnostic {
	return { severity: "error", range: rangeOf(call), message, code };
}

function keywordProblems(call: Call, args: DocArg[]): Diagnostic[] {
	const problems: Diagnostic[] = [];
	for (const arg of args) {
		const value = call.values.get(arg.name);
		if (value !== undefined && wrongType(arg, value))
			problems.push(
				error(
					call,
					"type",
					`${call.name}: :${arg.name} takes a ${arg.type}, got ${literalText(value)}`,
				),
			);
		if (arg.required && !call.keywords.has(arg.name))
			problems.push(
				error(
					call,
					"missing-argument",
					`${call.name}: missing required argument ":${arg.name}"`,
				),
			);
	}
	return problems;
}

function arityProblems(call: Call, arity: Arity): Diagnostic[] {
	const { min, max } = arity;
	if (call.argCount >= min && (max === undefined || call.argCount <= max))
		return [];
	const expected = expectedArgs(arity);
	const noun = expected === "1" ? "argument" : "arguments";
	return [
		error(
			call,
			"arity",
			`${call.name}: expected ${expected} ${noun}, got ${call.argCount}`,
		),
	];
}

function problemsOf(call: Call, doc: CallDoc): Diagnostic[] {
	const { args, arity } = doc;
	const bareFormOfHybrid =
		arity !== undefined && call.keywords.size === 0 && call.argCount > 0;
	if (args?.length && !bareFormOfHybrid) return keywordProblems(call, args);
	return arity === undefined ? [] : arityProblems(call, arity);
}

export function diagnosticsForCalls(
	calls: Call[],
	docByName: ReadonlyMap<string, CallDoc>,
): Diagnostic[] {
	return calls.flatMap((call) =>
		problemsOf(call, docByName.get(call.name) ?? {}),
	);
}

export function callDiagnostics(
	text: string,
	docByName: ReadonlyMap<string, CallDoc>,
): Diagnostic[] {
	return diagnosticsForCalls(
		collectCalls(parseForms(tokenizeWithPositions(text))),
		docByName,
	);
}
