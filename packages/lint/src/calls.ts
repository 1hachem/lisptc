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
				const value = call.values.get(arg.name);
				if (value !== undefined && wrongType(arg, value))
					diagnostics.push({
						severity: "error",
						range,
						message: `${call.name}: :${arg.name} takes a ${arg.type}, got ${literalText(value)}`,
						code: "type",
					});
				if (!arg.required || call.keywords.has(arg.name)) continue;
				diagnostics.push({
					severity: "error",
					range,
					message: `${call.name}: missing required argument ":${arg.name}"`,
					code: "missing-argument",
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
				severity: "error",
				range,
				message: `${call.name}: expected ${expected} ${plural ? "arguments" : "argument"}, got ${call.argCount}`,
				code: "arity",
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
