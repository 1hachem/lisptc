import { cdrCell, EvalException } from "./errors.ts";
import type { Cell } from "./objects.ts";

export function soleArg(form: Cell, name: string): unknown {
	const arg = cdrCell(form);
	if (arg === null || arg.cdr !== null)
		throw new EvalException(`bad ${name}`, form);
	return arg.car;
}
