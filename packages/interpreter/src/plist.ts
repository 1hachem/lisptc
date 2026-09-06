import {
	Cell,
	EvalException,
	LispKeyword,
	type List,
	newLispKeyword,
	Sym,
} from "./lisp.ts";

export function keyName(key: unknown): string {
	if (key instanceof LispKeyword) return key.name;
	if (key instanceof Sym) return key.name;
	if (typeof key === "string") return key;
	throw new EvalException("keyword expected as key", key);
}

export function parsePlist(list: List): Map<string, unknown> {
	const out = new Map<string, unknown>();
	let j = list;
	while (j !== null) {
		const key = j.car;
		const rest = j.cdr as List;
		if (rest === null)
			throw new EvalException(
				"odd-length keyword list; missing value for",
				key,
			);
		const name = keyName(key);
		out.set(name, rest.car);
		j = rest.cdr as List;
	}
	return out;
}

export function splitKeywordArgs(
	list: List,
	allowed: readonly string[],
): {
	values: List;
	options: List;
} {
	const values: unknown[] = [];
	let j = list;
	while (j !== null) {
		if (
			j.car instanceof LispKeyword &&
			(j.cdr !== null || allowed.includes(j.car.name))
		)
			break;
		values.push(j.car);
		j = j.cdr as List;
	}
	let head: List = null;
	for (let i = values.length - 1; i >= 0; i--) head = new Cell(values[i], head);
	return { values: head, options: j };
}

export function plistOptions(
	list: List,
	allowed: readonly string[],
): Map<string, unknown> {
	const opts = parsePlist(list);
	for (const name of opts.keys())
		if (!allowed.includes(name))
			throw new EvalException(
				`unknown option; expected one of ${allowed.map((a) => `:${a}`).join(" ")}`,
				newLispKeyword(name),
			);
	return opts;
}
