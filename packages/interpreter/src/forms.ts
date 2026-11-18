import { cdrCell, EvalException } from "./errors.ts";
import { Lambda } from "./func.ts";
import { Cell, catchSym } from "./objects.ts";

export function soleArg(form: Cell, name: string): unknown {
	const arg = cdrCell(form);
	if (arg === null || arg.cdr !== null)
		throw new EvalException(`bad ${name}`, form);
	return arg.car;
}

export interface TryParts {
	readonly body: unknown;
	readonly handler: Lambda | Cell;
}

export function tryParts(form: Cell): TryParts {
	const arg = cdrCell(form);
	if (arg === null) throw new EvalException("bad try", form);
	const rest = cdrCell(arg);
	if (rest === null || rest.cdr !== null)
		throw new EvalException("bad try: exactly one catch clause expected", arg);
	const clause = rest.car;
	if (clause instanceof Lambda) return { body: arg.car, handler: clause };
	if (!(clause instanceof Cell) || clause.car !== catchSym)
		throw new EvalException("bad try: catch clause expected", clause);
	const handler = cdrCell(clause);
	if (handler === null)
		throw new EvalException("bad try: catch variable expected", clause);
	const params = handler.car;
	if (!(params instanceof Cell) || params.cdr !== null)
		throw new EvalException(
			"bad try: catch expects exactly one variable",
			params,
		);
	return { body: arg.car, handler };
}
