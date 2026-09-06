import type { Arity, DocArg } from "@repo/interpreter";
import {
	type Diagnostic,
	DiagnosticSeverity,
} from "vscode-languageserver/node.js";
import {
	type Call,
	collectCalls,
	parseForms,
	tokenizeWithPositions,
} from "./tokenize.ts";

export interface CallDoc {
	args?: DocArg[];
	arity?: Arity;
}

export function expectedArgs({ min, max }: Arity): string {
	if (max === undefined) return `at least ${min}`;
	return min === max ? `${min}` : `${min}-${max}`;
}

export function diagnosticsForCalls(
	calls: Call[],
	docByName: Map<string, CallDoc>,
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
		const { args, arity } = docByName.get(call.name) ?? {};
		const bareFormOfHybrid =
			arity !== undefined && call.keywords.size === 0 && call.argCount > 0;
		if (args?.length && !bareFormOfHybrid) {
			for (const arg of args) {
				if (!arg.required || call.keywords.has(arg.name)) continue;
				diagnostics.push({
					severity: DiagnosticSeverity.Error,
					range,
					message: `${call.name}: missing required argument ":${arg.name}"`,
					source: "lisptc",
				});
			}
		} else if (
			arity !== undefined &&
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
		}
	}
	return diagnostics;
}

export async function callDiagnostics(
	text: string,
	resolve: (name: string) => Promise<CallDoc>,
): Promise<Diagnostic[]> {
	const calls = collectCalls(parseForms(tokenizeWithPositions(text)));
	const names = [...new Set(calls.map((c) => c.name))];
	const docByName = new Map(
		await Promise.all(
			names.map(async (name) => [name, await resolve(name)] as const),
		),
	);
	return diagnosticsForCalls(calls, docByName);
}
