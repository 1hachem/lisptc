/*
 * Zod schemas for the arguments of built-in functions. Validation failures
 * are surfaced as EvalException via parseArgs, matching the historical
 * hand-written checks (e.g. "list expected", "not a number").
 */
import { z } from "zod";
import { isNumeric, type Numeric } from "./arith.ts";
import { EvalException } from "./exceptions.ts";
import { Cell, type List, Sym } from "./sexpr.ts";

export const zAny = z.unknown();
export const zList = z.custom<List>(
	(x) => x === null || x instanceof Cell,
	"list expected",
);
export const zCell = z.custom<Cell>((x) => x instanceof Cell, "cell expected");
export const zNumeric = z.custom<Numeric>(isNumeric, "not a number");
export const zString = z.custom<string>(
	(x) => typeof x === "string",
	"string expected",
);
export const zSym = z.custom<Sym>((x) => x instanceof Sym, "symbol expected");

// Validate a built-in's argument frame against a tuple schema, throwing an
// EvalException that names the offending argument on failure.
export function parseArgs<T extends z.ZodType>(
	schema: T,
	a: unknown[],
): z.infer<T> {
	const result = schema.safeParse(a);
	if (result.success) return result.data;
	const issue = result.error.issues[0];
	const index = issue?.path[0];
	throw new EvalException(
		issue?.message ?? "invalid argument",
		typeof index === "number" ? a[index] : a,
	);
}
