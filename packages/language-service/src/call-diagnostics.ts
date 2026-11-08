import type { Arity, DocArg, WordCap } from "@repo/interpreter/docs";
import {
	type Diagnostic,
	DiagnosticSeverity,
} from "vscode-languageserver-types";
import {
	type Call,
	collectCalls,
	parseForms,
	tokenizeWithPositions,
} from "./tokenize.ts";

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
				severity: DiagnosticSeverity.Error,
				range: {
					start: { line: arg.line, character: arg.char },
					end: {
						line: arg.line + lines.length - 1,
						character:
							lines.length === 1 ? arg.char + last.length : last.length,
					},
				},
				message: `${call.name}: holds at most ${words} words here, this one has ${count}`,
				source: "lisptc",
			},
		];
	});
}

export function expectedArgs({ min, max }: Arity): string {
	if (max === undefined) return `at least ${min}`;
	return min === max ? `${min}` : `${min}-${max}`;
}

export function diagnosticsForCalls(
	calls: Call[],
	docByName: ReadonlyMap<string, CallDoc>,
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const call of calls) {
		const range = {
			start: { line: call.head.line, character: call.head.char },
			end: {
				line: call.head.line,
				character: call.head.char + call.name.length,
			},
		};
		const { args, arity, wordCaps } = docByName.get(call.name) ?? {};
		if (wordCaps !== undefined) diagnostics.push(...overCap(call, wordCaps));
		const positional =
			arity !== undefined && (call.keywords.size === 0 || !args?.length);
		if (
			positional &&
			(call.argCount < arity.min ||
				(arity.max !== undefined && call.argCount > arity.max))
		) {
			const expected = expectedArgs(arity);
			const plural = expected !== "1";
			diagnostics.push({
				severity: DiagnosticSeverity.Error,
				range,
				message: `${call.name}: expected ${expected} ${plural ? "arguments" : "argument"}, got ${call.argCount}`,
				source: "lisptc",
			});
			continue;
		}
		for (const [index, arg] of (args ?? []).entries()) {
			const supplied = positional
				? index < call.argCount
				: call.keywords.has(arg.name);
			if (!arg.required || supplied) continue;
			diagnostics.push({
				severity: DiagnosticSeverity.Error,
				range,
				message: `${call.name}: missing required argument ":${arg.name}"`,
				source: "lisptc",
			});
		}
	}
	return diagnostics;
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
