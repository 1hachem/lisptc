import { z } from "zod";
import { isNumeric, type Numeric } from "./arith.ts";
import { EvalException } from "./errors.ts";
import { Cell, type List, Sym } from "./objects.ts";

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
