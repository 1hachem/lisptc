// Static call-site diagnostics: flags two kinds of call error without
// evaluating the buffer:
//  - a keyword-call binding missing a required `:arg`, mirroring the
//    runtime checks in packages/interpreter/src/mcp.ts (an MCP tool's
//    `validate`, or a plist built-in's own argument parsing, e.g.
//    connConfigFromArgs for load-mcp).
//  - a positional binding (built-ins, macros, user defuns) called with the
//    wrong number of arguments, mirroring Func.makeFrame's "arity not
//    matched" runtime check.

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

// A binding's call-site shape: `args` for keyword-call bindings, `arity` for
// everything else callable positionally — see Interp.arityOf. At most one is
// ever set for a given name.
export interface CallDoc {
	args?: DocArg[];
	arity?: Arity;
}

// How many arguments a call "expected" reads as, given a min/max arity.
export function expectedArgs({ min, max }: Arity): string {
	if (max === undefined) return `at least ${min}`;
	return min === max ? `${min}` : `${min}-${max}`;
}

// Pure: given the calls found in a buffer and each call's resolved doc,
// the diagnostics for missing required `:keyword`s or wrong positional
// argument counts.
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
		if (args?.length) {
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

// Tokenizes/parses `text`, resolves each call's doc via `resolve`, and
// returns diagnostics. `resolve` is injected so callers can hit a live
// session/interpreter (see server.ts's callDocFor) or a canned map (tests).
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
