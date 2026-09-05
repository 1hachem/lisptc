/*
 * Keyword-plist argument parsing, shared by every built-in called with native
 * keyword syntax — (linear/list-issues :query "auth"), (view x :offset 400).
 *
 * This lives apart from src/mcp.ts, which grew it first, because mcp.ts carries
 * the @modelcontextprotocol/sdk dependency: a consumer that only wants keyword
 * args (src/compression.ts) must not pull the MCP SDK in behind it.
 */
import {
	Cell,
	EvalException,
	LispKeyword,
	type List,
	newLispKeyword,
	Sym,
} from "./lisp.ts";

// Extract the string name from a :keyword, symbol, or string key.
export function keyName(key: unknown): string {
	if (key instanceof LispKeyword) return key.name;
	if (key instanceof Sym) return key.name;
	if (typeof key === "string") return key;
	throw new EvalException("keyword expected as key", key);
}

// Parse a keyword plist (:k1 v1 :k2 v2 ...) into a Map of name -> raw Lisp value.
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

/*
 * Split a variadic argument list into leading values and a trailing option
 * plist — what `(echo x y :offset 40)` needs.
 *
 * A keyword starts the options as soon as it *could* be one, which is any
 * keyword carrying a value after it — a misspelling included, so
 * `(echo big :ofset 40)` reaches `plistOptions` and is rejected rather than
 * printing the literal `:ofset 40` after the whole value. Splitting on known
 * names alone is what would let that typo through silently.
 *
 * What cannot be an option is a keyword at the very end with no value to
 * carry, and that one is data: `(echo (job-status job))` prints `:pending`,
 * since a keyword is the natural way to hold a status and printing one must
 * not need `(list …)` around it. `allowed` is the exception to the exception —
 * a trailing `:offset` is an option whose value was forgotten, and saying so
 * is more use than printing the word.
 */
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

/*
 * Parse a plist of options, rejecting any key not in `allowed`.
 *
 * Stricter than parsePlist, which an MCP tool call needs to stay lenient about
 * (its keys come from a remote schema). For a built-in the keys are fixed and a
 * silently-ignored typo is worse than an error: an agent that writes
 * (view x :ofset 400) must be told, not handed the first 400 words as if it had
 * asked for them.
 */
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
