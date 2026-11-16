import type { Arity, DocArg, WordCap } from "@repo/interpreter/docs";
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
	code: "missing-argument" | "arity" | "word-cap";
}

export interface CallDoc {
	args?: DocArg[];
	arity?: Arity;
	wordCaps?: readonly WordCap[];
}

function wordsIn(text: string): number {
	return text.split(/\s+/).filter((word) => word !== "").length;
}

function overCap(call: Call, caps: readonly WordCap[]): Diagnostic[] {
	return caps.flatMap(({ position, words }) => {
		const arg = call.positional[position];
		if (arg?.kind !== "atom" || !arg.text.startsWith('"')) return [];
		const count = wordsIn(arg.text.slice(1, -1));
		if (count <= words) return [];
		const lines = arg.text.split("\n");
		const last = lines.at(-1) ?? "";
		return [
			{
				severity: "error",
				code: "word-cap",
				range: {
					start: { line: arg.line, character: arg.char },
					end: {
						line: arg.line + lines.length - 1,
						character:
							lines.length === 1 ? arg.char + last.length : last.length,
					},
				},
				message: `${call.name}: holds at most ${words} words here, this one has ${count}`,
			},
		];
	});
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

function argumentProblems(call: Call, doc: CallDoc): Diagnostic[] {
	const { args, arity } = doc;
	const positional =
		arity !== undefined && (call.keywords.size === 0 || !args?.length);
	if (positional) return positionalProblems(call, arity, args ?? []);
	return keywordProblems(call, args ?? []);
}

function problemsOf(call: Call, doc: CallDoc): Diagnostic[] {
	return [
		...(doc.wordCaps === undefined ? [] : overCap(call, doc.wordCaps)),
		...argumentProblems(call, doc),
	];
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
