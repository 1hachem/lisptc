import type { Arity, DocArg } from "@repo/interpreter/docs";
import {
	type Call,
	collectCalls,
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
	code: "missing-argument" | "arity";
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

function missingArgument(call: Call, arg: DocArg): Diagnostic {
	return error(
		call,
		"missing-argument",
		`${call.name}: missing required argument ":${arg.name}"`,
	);
}

function keywordProblems(call: Call, args: DocArg[]): Diagnostic[] {
	return args.flatMap((arg) =>
		arg.required && !call.keywords.has(arg.name)
			? [missingArgument(call, arg)]
			: [],
	);
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

function positionalProblems(
	call: Call,
	arity: Arity,
	args: DocArg[],
): Diagnostic[] {
	const wrongCount = arityProblems(call, arity);
	if (wrongCount.length) return wrongCount;
	return args.flatMap((arg, index) =>
		arg.required && index >= call.argCount ? [missingArgument(call, arg)] : [],
	);
}

function problemsOf(call: Call, doc: CallDoc): Diagnostic[] {
	const { args, arity } = doc;
	const positional =
		arity !== undefined && (call.keywords.size === 0 || !args?.length);
	if (positional) return positionalProblems(call, arity, args ?? []);
	return keywordProblems(call, args ?? []);
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
